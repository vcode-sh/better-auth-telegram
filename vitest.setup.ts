// Suppress happy-dom DOMException warnings about external script loading.
// When tests append <script> elements to the DOM, happy-dom tries to load
// them and logs errors because file loading is disabled. This setting treats
// disabled file loading as a success event instead of logging errors.
if (typeof window !== "undefined" && "happyDOM" in window) {
  (window.happyDOM as any).settings.handleDisabledFileLoadingAsSuccess = true;
}
