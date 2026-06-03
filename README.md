# Shopping Kitty

A phone-friendly shopping kitty tracker for Kali and Keith.

## What it does

- Tracks monthly kitty contributions.
- Logs shopping while you are out, including quick sums like `106+52+97`.
- Deducts shopping from the month kitty automatically.
- Shows when the kitty is gone and how much extra shopping has been paid.
- Shows a simple settle-up amount based on who has paid more overall.
- Autosaves in the browser as you type and add entries.
- Includes JSON backup and restore.
- Can be added to a phone home screen when served from GitHub Pages.

## GitHub Pages

This is a static site. Put these files in a GitHub repository and enable GitHub Pages for the branch.

Open `index.html` locally to preview the basic app. For install/offline behavior, use GitHub Pages or another local web server because service workers require HTTP/HTTPS.

## Shared Sync Note

The app autosaves on each device using browser storage first, then syncs to Firebase Firestore when available.

## Firestore Rules

After testing in Firestore test mode, replace the rules with:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /households/kali-keith-7f4c2a91/{document=**} {
      allow read, write: if true;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

These rules keep the rest of the database closed and only allow this one household tracker path.
