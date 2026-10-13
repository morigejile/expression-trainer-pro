Visual baseline: `demo/freeze-v1`, commit `ab714d641829fd8db8beae1fd17ae1d180284ded`, `design-preview-merged/`.

`training.css` contains the frozen training app, continuity, spacing, panel font and content alignment styles in their original order. `report.css` contains the frozen study and state styles. They are enabled for the migrated Training, Report, History and Comparison surfaces. `../frozen-flow.css` adapts existing Renderer controls to that geometry. No Demo business, recording, timing or persistence scripts are included.

Manrope and Source Han Sans fonts retain their accompanying SIL Open Font License files. The existing brand SVG is used as the App Shell mask without changing its master asset.
## Utility

`utility.css` is copied from the same read-only Frozen Demo baseline for I5 Settings/Help. It retains the existing font assets and licenses above; UI adapters use real application APIs instead of Demo mechanisms.
