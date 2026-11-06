# Scan limitations

This is an on-device helper for photos of Yu-Gi-Oh and Magic cards. It is not a grader, an authenticator, or a price feed.

## What it will not do

- It does not send the photo to a server, a model API, or a paid endpoint. There is no token fallback.
- It does not save the photo in `localStorage`, the service-worker cache, or this git repo. The working copy stays in the tab and is released when you replace it.
- It does not know the full Yu-Gi-Oh or Magic catalog. It can only point at rows already shipped in `data.js`, plus collection notes in that same file.
- It does not confirm a print by itself. A set code match is still a suggestion until you press the row.
- It does not prove a card is genuine.
- It does not produce a PSA grade, a subgrade, or a grade probability. `grade10_rate` and `psa10_odds` in the deal data are not shown.
- It does not invent PSA 5, 6, 7, or 8. Those rows stay **Unavailable** unless `scan/verified-prices.json` has a sourced figure for that exact catalog id.
- It does not turn a PriceCharting volume phrase such as "1 sale per week" into a sales count.
- It does not convert USD figures to CAD. The rest of the site has a separate fixed display factor. The scan table shows the stored USD numbers.
- It does not treat a snapshot price and a history point as the same observation when the numbers differ. Both are shown.
- A price of `0` in the snapshot is treated as missing, not as a free card.

## Identification

Text is read by Tesseract.js 5.1.1 with the English LSTM model, running in the browser on a worker loaded from this origin (`scan/vendor/`). The library's character scores are not requested and are not shown. A progress percentage, when the library reports one, is only the OCR job's progress.

The English model misses stylized titles, foil glare, Japanese and other languages, and small print. Set codes are the useful signal when they are printed in Latin letters. `EN` inside a code such as `RA05-EN094` is shown as English. A code with no language segment, including `LON-000` and `LAVD-ENO34`, stays **Unknown** rather than defaulting to English.

The back photo is not used to name the card. Yu-Gi-Oh and Magic backs are shared by many cards.

If several catalog rows share a name, or the same set code with different rarities, all of those rows are listed. Magic rows in this snapshot usually do not include a set code. The PriceCharting product slug from the stored URL is shown so those rows can be told apart. Choosing one is your confirmation of the catalog row, not a proof of the physical printing.

A one-character mix-up such as `O`/`0` is labelled as not an exact code match, and only when a name word also matches.

## Photo checks

- Files over 8 MB are refused before decode.
- HEIC is refused. JPEG, PNG, WebP, and GIF can be decoded when the browser can decode them.
- The working copy's long side is capped at 1600 px so a phone does not hold a full camera frame. Zoom inspects that working copy, not the extra pixels from the original file.
- Resolution uses the original pixel size. A short side under 500 px is called low for small print.
- Blur uses the variance of a Laplacian on a sample about 400 px wide. Near-zero variance is "likely blurry or lacking detail". Very high variance is not flagged. The band in between is **not assessable**. Mild blur is often not flagged.
- Glare is the share of pixels at luminance 250 or more. Under 0.5% is no large clipped highlight. 0.5% to 20% is possible glare. Above 20% is **not assessable** because the sample may simply be a white field.
- Centering is measured only when four borders are stable, high-contrast, and a plausible width. Otherwise it is **not assessable**. A measured split is not a PSA centering subgrade.
- Corners, edges, and surface are a checklist you fill in. They are not measured.

A tighter crop is suggested only when the corners of the photo are a flat background and the subject has a card-shaped outline. Other photos keep the crop you set.

## Prices and freshness

For a confirmed row the table can show:

- a packaged snapshot from `data.js` (USD PriceCharting figure, observation time **Unavailable**, sales count **Unavailable**)
- the latest positive point in `h/<game>/<id>.json` when that file has one, with that point's timestamp
- a grade from `scan/verified-prices.json` when the record has price, currency, source, and `observed_at`

An observation older than 45 days on the device clock is labelled **stale** and still shown. A missing series stays **Unavailable**. The current shipped file has no verified grades, so PSA 5–8 are unavailable for every row.

## Offline and updates

The scan shell is precached. The OCR engine is not. After one successful online read, the service worker can reuse the engine files offline. A first visit with no network can open Scan and search the cached list, and the text reader fails until those files have been cached.

Installing a newer `sw.js` still deletes caches whose names differ from the current `cd3-…` cache. The daily generator must keep the hook in `scan/INTEGRATION.md` or the next rebuild drops the button even though the `scan/` files remain in git.

## Speed

`node scan/bench/run.mjs` on 2026-11-05 wrote `scan/bench/results.json`.

That run was headless Chrome 156 on this Linux VM (4 vCPU Intel Xeon, about 16 GB RAM, Node 22). It was not a phone, and a phone-sized window in the UI tests does not change the CPU. Do not treat these numbers as phone speed.

On two sharp synthetic cards drawn in a plain font:

- Cold start, including loading the local OCR engine: 484 ms. About 397 ms was startup and about 87 ms was the first read.
- Warm read of the same image: 130 ms.
- Warm read of a second card: 126 ms.
- A second identification pass was not needed once a set code was present: 122 ms.
- Requests stayed on the test origin. The engine files were `tesseract.esm.min.js`, `worker.min.js`, `tesseract-core-simd-lstm.wasm.js`, and `eng.traineddata.gz`.

The first image was read as "Gemini EIf" plus an exact `LON-000`. The name was wrong and the set code was right, so the row was only a suggestion. The second image contained an exact `LC01-EN004` and also a misread `LCO1-ENOO4`. A softened copy of the first image produced no set code and no catalog row. Real foil, glare, and stylized titles are less reliable than these fixtures.

## Not live yet

Merging this branch does not by itself update the site people open. The generator on the other computer has to keep the hook, the deploy has to finish, and someone has to check a phone and a desktop after that.
