use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{SampleFormat, WavSpec, WavWriter};
use std::fs::{self, File};
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use chrono::{Local, Timelike};

use crate::SIDECAR_PORT;

struct RecordingState {
    stop_flag: Option<Arc<Mutex<bool>>>,
    start_time: Option<std::time::Instant>,
    output_path: Option<PathBuf>,
}

static RECORDING_STATE: once_cell::sync::Lazy<Mutex<RecordingState>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(RecordingState {
            stop_flag: None,
            start_time: None,
            output_path: None,
        })
    });

fn recordings_dir() -> PathBuf {
    // Use ~/Library/Application Support/<bundle-id>/recordings for production safety
    let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
    let dir = home.join("Library/Application Support/com.recording-dashboard.app/recordings");
    fs::create_dir_all(&dir).ok();
    dir
}

fn generate_filename() -> String {
    let now = Local::now();
    format!(
        "recording_{}_{:02}-{:02}-{:02}.wav",
        now.format("%Y-%m-%d"),
        now.hour(),
        now.minute(),
        now.second()
    )
}

#[tauri::command]
pub fn start_recording() -> Result<String, String> {
    let mut state = RECORDING_STATE.lock().map_err(|e| e.to_string())?;

    if state.stop_flag.is_some() {
        return Err("Already recording".into());
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device available")?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();

    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };

    let filename = generate_filename();
    let path = recordings_dir().join(&filename);
    let file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    let writer = WavWriter::new(BufWriter::new(file), spec)
        .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

    let stop_flag = Arc::new(Mutex::new(false));
    let stop_flag_clone = Arc::clone(&stop_flag);
    let path_clone = path.clone();

    // Spawn recording in a dedicated thread
    std::thread::spawn(move || {
        let writer = Arc::new(Mutex::new(Some(writer)));
        let writer_clone = Arc::clone(&writer);

        let stream_result = match config.sample_format() {
            cpal::SampleFormat::I16 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if let Ok(mut guard) = writer_clone.lock() {
                            if let Some(w) = guard.as_mut() {
                                for &sample in data {
                                    w.write_sample(sample).ok();
                                }
                            }
                        }
                    },
                    |err| eprintln!("Recording error: {}", err),
                    None,
                ),
            cpal::SampleFormat::F32 => {
                let writer_clone = Arc::clone(&writer);
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if let Ok(mut guard) = writer_clone.lock() {
                            if let Some(w) = guard.as_mut() {
                                for &sample in data {
                                    let sample = (sample * 32767.0) as i16;
                                    w.write_sample(sample).ok();
                                }
                            }
                        }
                    },
                    |err| eprintln!("Recording error: {}", err),
                    None,
                )
            }
            _ => {
                eprintln!("Unsupported sample format");
                return;
            }
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to build stream: {}", e);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("Failed to start recording: {}", e);
            return;
        }

        // Wait until stop flag is set
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(flag) = stop_flag_clone.lock() {
                if *flag {
                    break;
                }
            }
        }

        // Stop stream (dropped here)
        drop(stream);

        // Finalize WAV file
        if let Ok(mut guard) = writer.lock() {
            if let Some(w) = guard.take() {
                if let Err(e) = w.finalize() {
                    eprintln!("Failed to finalize WAV: {}", e);
                }
            }
        }

        eprintln!("Recording saved to: {}", path_clone.display());
    });

    state.stop_flag = Some(stop_flag);
    state.start_time = Some(std::time::Instant::now());
    state.output_path = Some(path.clone());

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn stop_recording() -> Result<String, String> {
    let mut state = RECORDING_STATE.lock().map_err(|e| e.to_string())?;

    if state.stop_flag.is_none() {
        return Err("Not recording".into());
    }

    // Signal the recording thread to stop
    if let Some(flag) = state.stop_flag.take() {
        if let Ok(mut f) = flag.lock() {
            *f = true;
        }
    }

    let path = state.output_path.take().unwrap_or_default();
    state.start_time = None;

    // Give the thread a moment to finalize
    std::thread::sleep(std::time::Duration::from_millis(500));

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn is_recording() -> bool {
    RECORDING_STATE
        .lock()
        .map(|state| state.stop_flag.is_some())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn upload_recording(file_path: String) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let file_bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Build multipart form manually
    let boundary = "----FormBoundary7MA4YWxkTrZu0gW";
    let mut body = Vec::new();

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"recording\"; filename=\"{}\"\r\n",
            filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: audio/wav\r\n\r\n");
    body.extend_from_slice(&file_bytes);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .post(format!("http://127.0.0.1:{}/api/recordings/process", SIDECAR_PORT))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(json)
}
