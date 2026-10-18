# Marvel Nums redesign notes

Brand name: Marvel Nums. The uploaded banner and three uploaded background artworks are used as page backgrounds, and the main emblem/wordmark crop is used as the site logo asset. The favicon and Apple touch icon are derived from the emblem in the uploaded banner.

Page background selection is handled by `dist/js/marvinums-brand.js`; backgrounds are shared across page groups to ensure no old plain background remains where the global style is loaded. Existing business logic and admin/customer features should be runtime-tested before production deployment.
