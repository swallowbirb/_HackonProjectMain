# Bugfix Requirements Document

## Introduction

The fraud preflight's perceptual-hash (phash) check is the only HARD fraud signal in the
grading pipeline. A HARD signal short-circuits grading (skips both Gemini passes) and rejects
the submission, and it exists specifically to catch lifted catalog/stock photos — a seller or
returner passing off the original product listing photo as their own "evidence" photo.

In production this check never fires. `phash_match` compares each submitted photo against a list
of `catalog_hashes`, but that list is always empty: the backend never computes perceptual hashes
of the listing/catalog reference photos and never populates `payload.catalogHashes`, so the ML
service receives `catalog_hashes: []`. With an empty catalog hash list, `phash_match` returns
`False` immediately, `any_phash_match` can never become `True`, and the HARD short-circuit path
is effectively dead code.

The observable symptom is the Developer Logs Sidebar line:
"Fraud preflight: checking 1 photo(s) against 0 catalog hash(es)". A lifted catalog photo passes
straight through fraud preflight as if clean.

The fix wires catalog perceptual hashes through end-to-end so the phash HARD signal actually
functions, using the listing/catalog reference photos that are already resolved from
`product.images` (the same set surfaced as `listingImageUrls`). The design phase will evaluate
where the hash computation belongs (backend pre-compute vs ML-side compute from
`listing_image_urls` already present in the request payload).

Out of scope (confirmed correct behavior, not bugs): `missing_exif` producing a SOFT
classification on a game screenshot. Screenshots legitimately have no camera EXIF; the EXIF logic
must not change.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an item is graded and the listing/catalog reference photos exist (resolved from `product.images`) THEN the backend sends `catalog_hashes: []` to the ML service because it never computes perceptual hashes from those reference photos.

1.2 WHEN the ML service runs `run_preflight` with an empty `catalog_hashes` list THEN `phash_match` returns `False` immediately for every submitted photo (`if not catalog_hashes: return False`), so `any_phash_match` is always `False`.

1.3 WHEN a submitted evidence photo is a lifted/near-duplicate copy of a catalog reference photo THEN the system fails to raise the HARD `phash_match_catalog` signal and does NOT short-circuit grading, allowing the lifted photo through fraud preflight.

1.4 WHEN the fraud preflight runs THEN the Developer Logs Sidebar reports "checking N photo(s) against 0 catalog hash(es)", confirming the catalog hash list is always empty.

### Expected Behavior (Correct)

2.1 WHEN an item is graded and listing/catalog reference photos are available THEN the system SHALL make perceptual hashes of those reference photos available to `run_preflight` (either pre-computed by the backend and passed as `catalog_hashes`, or computed by the ML service from `listing_image_urls`), so the catalog hash set passed to `phash_match` is non-empty.

2.2 WHEN a submitted evidence photo is a lifted/near-duplicate copy of a catalog reference photo (perceptual-hash Hamming distance within `phash_hamming_threshold`) THEN the system SHALL raise the HARD `phash_match_catalog` signal, classify the submission as HARD, and short-circuit grading (skip both Gemini passes, reject the submission).

2.3 WHEN reference photos are available and hashes are computed THEN the Developer Logs Sidebar SHALL report a non-zero catalog hash count ("checking N photo(s) against M catalog hash(es)" with M > 0).

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a submitted photo is NOT a near-duplicate of any catalog reference photo THEN the system SHALL CONTINUE TO leave `phash_match` as `False` and classify based on the remaining signals (EXIF, Rekognition) exactly as before.

3.2 WHEN no listing/catalog reference photos are available for a product THEN the system SHALL CONTINUE TO run grading on the evidence photos alone without raising a phash HARD signal and without erroring.

3.3 WHEN a photo lacks camera EXIF metadata (e.g., a game screenshot) and no phash match occurs THEN the system SHALL CONTINUE TO produce the SOFT `missing_exif` classification (explicitly out of scope — EXIF logic unchanged).

3.4 WHEN the `classify` function receives the same `(any_phash_match, any_exif_camera, any_web_match)` inputs THEN it SHALL CONTINUE TO return the same classification and triggering signal as before (pure classification logic unchanged).

3.5 WHEN a reference image cannot be fetched or its hash cannot be computed THEN the system SHALL CONTINUE TO degrade gracefully (treat as "not detected", log, and continue), per the existing defensive-check policy.
