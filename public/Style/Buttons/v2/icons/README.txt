Smart3D map toolbar — standalone icon set
========================================

Source sprite: ../all_buttons.svg (edit symbols there, then rebuild)

Rebuild standalone SVGs + toolbar CSS:
  npm run build:toolbar-icons
  node public/Style/build-toolbar-icons.mjs

Outputs:
  *.svg          — full SVG documents (24×24, currentColor), safe for <img>, Figma, docs
  manifest.json  — symbol id ↔ filename
  ../Smart3d_Style.toolbar.css — embedded data URIs used by the live viewer

CSS class → file (toolbar):
  .transparency     transparency.svg
  .fog              fog.svg
  .white            white-model.svg   (symbol white2)
  .slope            slope.svg
  .height           height.svg
  .distance         distance.svg
  .direction         direction.svg
  .snow             snow.svg
  .clouds           clouds.svg
  .ortho            ortho.svg
  .remapColors      remap-colors.svg
  .layersIC         layers.svg
  .home             home.svg
  .gotoPrev         goto-prev.svg
  .gotoNext         goto-next.svg
  .topview          top-view.svg
  .share            share.svg
  .printscreen      print-screen.svg
  .measure          measure.svg
  .lineofsight      los.svg
  .viewshed         viewshed.svg     (symbol viewshed2)
  .elevationProfile elevation-profile.svg
  .streetview       street-view.svg
  .clipplane        cut.svg
  .split            split.svg
  .special_effects  special-effects.svg

North compass overlay: north.svg (used on .north-arrow; #navNorth has no tile icon by design)
