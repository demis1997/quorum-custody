.PHONY: demo native install check test integration screenshots stop
install:
	npm ci --ignore-scripts --cache .build/npm-cache
native:
	bash scripts/build-native.sh
demo: install native
	npm run build
	npm run provision
	node --import tsx scripts/start.ts
	npm run demo
check:
	npm run typecheck
	npm run lint
	npx prettier --check src scripts tests ui
	npm run build
	npm run test
test:
	npm run test
integration:
	npm run integration
screenshots:
	PLAYWRIGHT_BROWSERS_PATH=$(CURDIR)/.build/browsers npx playwright install chromium
	PLAYWRIGHT_BROWSERS_PATH=$(CURDIR)/.build/browsers node --import tsx scripts/screenshots.ts
stop:
	node --import tsx scripts/stop.ts
