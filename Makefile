SHELL := /bin/bash

# Extract version from manifest.json
VERSION := $(shell sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' manifest.json)

# Files and folders
DIST_DIR := dist
ZIP_NAME := standup-extension-$(VERSION).zip

.PHONY: help version config package zip clean

help:
	@echo "Targets:"
	@echo "  make version              # Print manifest version"
	@echo "  make config               # Generate config.json from env vars"
	@echo "      (use) SUPABASE_URL=... SUPABASE_ANON_KEY=..."
	@echo "  make package              # Create $(DIST_DIR)/$(ZIP_NAME)"
	@echo "  make clean                # Remove dist and local zip files"

version:
	@echo $(VERSION)

# Create config.json from environment variables
config:
	@if [[ -z "$$SUPABASE_URL" || -z "$$SUPABASE_ANON_KEY" ]]; then \
		echo "Error: SUPABASE_URL and SUPABASE_ANON_KEY env vars are required."; \
		echo "Example:"; \
		echo "  make config SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=abc123"; \
		exit 1; \
	fi
	@echo "{\n  \"SUPABASE_URL\": \"$${SUPABASE_URL}\",\n  \"SUPABASE_ANON_KEY\": \"$${SUPABASE_ANON_KEY}\"\n}" > config.json
	@echo "Wrote config.json"

# Package the extension into dist/ with the current manifest version
package: ensure-config
	@mkdir -p $(DIST_DIR)
	@zip -r "$(DIST_DIR)/$(ZIP_NAME)" . \
		-x ".git/*" \
		-x "$(DIST_DIR)/*" \
		-x "*.log" \
		-x "*/.DS_Store" \
		-x "*.zip" >/dev/null
	@ls -lh "$(DIST_DIR)/$(ZIP_NAME)"

# Internal check: ensure config.json present and not the example
ensure-config:
	@if [[ ! -f config.json ]]; then \
		echo "Error: config.json missing. Run: make config SUPABASE_URL=... SUPABASE_ANON_KEY=..."; \
		exit 1; \
	fi
	@if grep -q "YOUR_PROJECT" config.json; then \
		echo "Error: config.json contains placeholder values. Update it before packaging."; \
		exit 1; \
	fi

clean:
	@rm -rf $(DIST_DIR) *.zip
	@echo "Cleaned dist and zip files."

