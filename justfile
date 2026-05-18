dev:
	pnpm dev

build:
	pnpm build

lint:
	pnpm lint

type-check:
	pnpm exec tsc --noEmit

ai-check: lint type-check
