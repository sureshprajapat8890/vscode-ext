# Preview your whole app

Run **RN Lens: Preview App** to render the whole app instead of a single component. RN Lens finds the entry in this order:

1. The `rnLens.entry` setting.
2. expo-router's `app/` directory.
3. `main` in package.json.
4. `index.*`, then `App.*`.

React Navigation and expo-router work as they do on web, so you can tap through your screens. Use the platform toggle in the toolbar to render `.ios` or `.android` files.
