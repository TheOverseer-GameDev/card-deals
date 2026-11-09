# Set up the Card Deals market

The market is off until two values are filled in. An empty config shows “Market not connected yet” and does not invent listings.

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Create a new project. Pick a name, a database password, and a region close to you. Wait until the project says it is ready.
3. Open Project Settings, then API.
4. Copy the Project URL. Paste it into `market/config.js` as `SUPABASE_URL`.
5. Copy the `anon` `public` key. Paste it into `market/config.js` as `SUPABASE_ANON_KEY`.
6. Do not paste the `service_role` key anywhere in this site. That key bypasses the safety rules.
7. Open the SQL Editor. Open `supabase/schema.sql` from this repo, paste the whole file, and run it. If the last storage lines fail, the tables above are the important part: tell the person who maintains the site, and do not keep retrying with the service role key in the browser.
8. Open Authentication, then Providers, and leave Email turned on.
9. Open Authentication, then URL Configuration. Set the Site URL to the address of this site, for example `https://theoverseer-gamedev.github.io/card-deals/`. Add the same address under Redirect URLs.
10. Reload the site, open Market, type the email you want to use, and send the sign-in link. Open that link on the same phone or computer.
11. Choose a display name, then add an Interac email or a PayPal.me name if you plan to sell. Buyers cannot see those until you accept their offer.

Photos are stored only when a seller checks the consent box. The photo bucket is public, so a photo that was uploaded can be seen with the listing. Card Deals never holds the payment. People pay each other directly.
