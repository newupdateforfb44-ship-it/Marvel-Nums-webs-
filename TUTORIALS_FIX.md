# Tutorials feature — upload notes

Adds a **Tutorials** section. The admin adds unlimited video tutorials (title, sub-heading,
discussion text + a video). Customers watch them on **/tutorials**.

## Upload these 6 files (same flat-name way as before; `organize.js` puts them in the right folders)
NEW:
- `lib__tutorials.js`        -> lib/tutorials.js  (server routes, video upload, database model)
- `public__tutorials.html`   -> public/tutorials.html  (customer page)

REPLACE (overwrite the old ones):
- `server.js`                (2 lines added: loads the tutorials module + /tutorials in the sitemap)
- `public__admin.html`       (new "Tutorials" tab in the admin panel)
- `public__js__marvinums-brand.js` (adds a "Tutorials" link in the top menu + phone quick menu)
- `organize.js`              (so the two new files are placed in their folders)

No new packages, no database migration. Restart/redeploy after uploading.

## How the admin uses it
Admin panel -> left menu -> Community -> **Tutorials**
1. Type the Title (e.g. "How to log in a TikTok account"), Sub-heading, and the Discussion text.
2. Choose a video file (mp4 / mov / webm, up to 100 MB) **or** paste a YouTube / Vimeo / direct video link.
3. Tap **Add tutorial**. A progress bar shows the upload.
In "Your tutorials": move up/down, Edit (change text or replace the video), Hide/Show, Delete.
Hidden tutorials are drafts - customers don't see them.

## Important: video storage
- With **Cloudinary** connected (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET on Render) uploaded
  videos are stored permanently.
- Without Cloudinary, uploaded files sit on the server disk and are **lost when Render restarts**.
  The admin tab shows a red warning when this is the case. YouTube/Vimeo links are never lost.
- Videos larger than 100 MB: upload to YouTube (Unlisted) and paste the link.

## If you would rather not replace server.js
Open server.js, find this line:
    require('./lib/welcomepopup').register(app, { mongoose, adminAuth });
and add directly under it:
    require('./lib/tutorials').register(app, { mongoose, adminAuth });
(That is the only change in server.js besides the sitemap path.)
