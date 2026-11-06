# Scan limitations

This is an on-device helper for photos of Yu-Gi-Oh and Magic cards. It is not a grader, an authenticator, or a price feed.

## What it will not do

- It does not send the photo to a server, a model API, or a paid endpoint. There is no token fallback.
- It does not save the photo in `localStorage`, the service-worker cache, or this git repo. The working copy stays in the tab and is released when you replace it.
- It does not know the full Yu-Gi-Oh or Magic catalog. It can only point at rows already shipped in `data.js`, plus collection notes in that same file.
- It does not confirm a print by itself. A set code match is still a suggestion until you press the row.
- It does not prove a card is genuine.
- It does not produce a PSA grade, a subgrade, a certification, or a grade probability. A potential PSA range is a photo-supported estimate only. `grade10_rate` and `psa10_odds` in the deal data are not shown, and no confidence percentage is shown.
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
- The same blur and glare rules run on regions of the crop: four corners (10% squares), four edge strips, the center 70%, and the title/print block. A region whose original short side is under 32 px fails for low resolution. Blur variance below 30 fails. Variance from 30 through 120 is **unknown**. Clipped pixels (luminance 250 or more) from 0.5% to 20% of a region fail for glare. Above 20% the region is **unknown** because it may simply be a white field. A trace of clipped pixels from 0.2% to 0.5% is a warning. Unknown and failed regions are not clean.
- You cannot mark a corner, edge, or surface group clean while any region in that group is failed or unknown. The checklist is still your note. It is not a measured subgrade.
- Retake lines name the side, the region, the reason, and one tip. They are not a grade.

A tighter crop is suggested only when the corners of the photo are a flat background and the subject has a card-shaped outline. Other photos keep the crop you set.

## Prices and freshness

For a confirmed row the table can show:

- a packaged snapshot from `data.js` (USD PriceCharting figure, observation time **Unavailable**, sales count **Unavailable**)
- the latest positive point in `h/<game>/<id>.json` when that file has one, with that point's timestamp
- a grade from `scan/verified-prices.json` when the record has price, currency, source, and `observed_at`

An observation older than 45 days on the device clock is labelled **stale** and still shown. A missing series stays **Unavailable**. The current shipped file has no verified grades, so PSA 5–8 are unavailable for every row.

Completed sales and asking prices come only from `scan/market/<game>/<id>.json` after you confirm a row. The two lists are separate. A row is kept only when that file already has a positive price, currency, source, observation time, and the exact print id. A sold row is never shown as an ask. An asking price is never copied into another condition. If the shard is missing, both lists say **Unavailable**. Nothing is converted between USD and CAD.

The bar chart uses those sourced points only. Completed sales are preferred. If the file has asks and no sales, the title is **Asking prices over time**. Empty months are gaps, not zeros and not filled from the months beside them. The window is five years, or the card's shipped release time when that time is present and shorter. Shipped history in `h/` stays in the stored-figures table. It is not redrawn as a completed sale.

The three meters are separate. Buying risk adds listed factors (unconfirmed print, unknown regions, stale prices, no completed sales, a wide sold-to-ask gap, a shipping or stored-CAD flag, a missing back). It is not a probability of loss. Current value describes how much completed-sale evidence is on file. It is not a price target, and it stays **Unavailable** when there are no completed sales. Future potential lists scenario tags from the market shard. With no scenario list it stays **Unavailable**. It is not a promise that a price will rise. No meter is a slice of one pie.

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

## Potential PSA range

The range is whole numbers. It is labelled as a potential PSA grade estimate, not a PSA certification. Photos cannot prove hidden defects, alterations, or authenticity. PSA may grade higher or lower.

The ceiling uses the live PSA 10 centering line (front about 55/45, reverse about 75/25). Grades 9 through 3 use the secondary table in the research notes, because the live PSA page did not expose that carousel text when it was checked. Recheck the live carousel before treating those cutoffs as current PSA wording. There is no measured accuracy and no confidence percentage. Four or more critical regions that are failed or unknown (corners, edges, and center, front and back) produce **Estimate unavailable — retake required** instead of a number. A missing back photo, unknown centering, glare, blur, and a clean note on a blocked region all keep the ceiling from rising. A clean note on a blocked region is dropped.

## What a phone photo still cannot show

A photo cannot reliably prove micro-surface under foil glare, a pressed crease, cleaning, trimming, true color under a strong cast, factory texture versus an aftermarket surface, or the grade a person will assign under magnification. OCR misreads foil and stylized type. The catalog is not the full Yu-Gi-Oh or Magic universe. Market JSON is only as fresh as the last free-tracker export.

The Galaxy S22 lines on the capture screen are capture advice. They were not checked on a physical Galaxy S22.

## Not live yet

Merging this branch does not by itself update the site people open. The generator on the other computer has to keep the hook, the deploy has to finish, and someone has to check a phone and a desktop after that.
