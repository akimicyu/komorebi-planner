# こもれび計画

- Edit src/app.js and src/template.html. index.html is generated; run npm run build and commit the generated index.html with source changes.
- npm run check validates syntax, scheduling logic, and generates the standalone HTML. No dependency installation is required.
- Keep the app usable by opening index.html directly without a server or network dependencies.
- Preserve backwards compatibility with version 1 project JSON, including files without owners.
- Project data stays in the browser or files explicitly opened/saved by the user. Do not add telemetry, remote APIs, external libraries loaded at runtime, or uploads without explicit user authorization.
- Never commit user project JSON, browser storage, screenshots, authentication data, or local backups. Only fictional sample data belongs in source control.
- GitHub Pages publishes index.html from the root of main. Always include generated output when updating the application.
