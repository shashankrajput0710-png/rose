# Rose Storybook

Open `index.html` in a browser to run the storybook.

## Replace the placeholder photos

- Put the Page 2 bloom photo at `assets/page2-photo.jpg`
- Put the Page 3 puzzle photo at `assets/page3-puzzle.jpg`

If those files are missing, the site uses the included placeholder art.

## Included media

- Video: `assets/rose-video.mp4`
- Song: `assets/rose-song.mp3`

## Private letter inbox

Page 5 now supports two modes:

- Local mode by default: saves on the same browser/device
- Remote mode with Supabase: lets you read the notes from your own device too

- Normal view: `index.html`
- Private inbox view on the same browser/device: `index.html?admin=rose`

## Cross-device setup

To read her note on your own device, turn on the remote inbox in `config.js`.

1. Create a Supabase project
2. Run the SQL from `supabase_setup.sql`
3. Put your project URL and anon key into `config.js`
4. Set `enabled: true`

After that:

- whatever she writes on Page 5 will sync online
- opening `index.html?admin=rose` on your device will fetch those synced notes too

Important:

- the page now says the note is secret, but true secrecy depends on your backend rules
- the included setup is practical for syncing, but if you want stronger privacy than public-anon frontend access, the next step is a tiny protected backend or auth layer

## Add more pages

The last built-in page lets you add custom pages.

- New pages are saved in browser local storage
- You can edit or delete them later from the same page
