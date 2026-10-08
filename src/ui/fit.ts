import { useEffect } from 'react';

/** Below this the text is unreadable; layouts are compacted so real screens never get near it. */
const MIN_ZOOM = 0.5;
const STEP = 0.02;

/** Shrinks `el` (CSS zoom) just until `overflows()` is false, so nothing ever needs scrolling. */
function shrinkToFit(el: HTMLElement, overflows: () => boolean): void {
  el.style.zoom = '';
  let zoom = 1;
  while (overflows() && zoom > MIN_ZOOM) {
    zoom = Math.max(MIN_ZOOM, Math.round((zoom - STEP) * 100) / 100);
    el.style.zoom = String(zoom);
  }
}

/**
 * Same for a modal dialog. Its width and height caps are in the element's own (zoomed) units, so they
 * are divided by the zoom: the dialog keeps its on-screen size while its text gets smaller and reflows
 * into the space that frees up.
 */
function shrinkDialogToFit(dialog: HTMLDialogElement): void {
  dialog.style.zoom = '';
  dialog.style.width = '';
  dialog.style.maxHeight = '';
  const width = dialog.getBoundingClientRect().width;
  const maxHeight = window.innerHeight - 24;
  const overflows = () => dialog.scrollHeight > dialog.clientHeight || dialog.scrollWidth > dialog.clientWidth;
  let zoom = 1;
  while (overflows() && zoom > MIN_ZOOM) {
    zoom = Math.max(MIN_ZOOM, Math.round((zoom - STEP) * 100) / 100);
    dialog.style.zoom = String(zoom);
    dialog.style.width = `${width / zoom}px`;
    dialog.style.maxHeight = `${maxHeight / zoom}px`;
  }
}

const pageOverflows = () => {
  const page = document.scrollingElement;
  return !!page && (page.scrollHeight > window.innerHeight || page.scrollWidth > window.innerWidth);
};

/**
 * Menu screens and open dialogs are laid out at full size and, only if they stick out of the window,
 * shrunk to fit: no screen scrolls at any window size or zoom. Runs in a mutation callback (before
 * paint), so there is no flash of an unfitted page. The game screen is not touched (it letterboxes).
 */
export function useFitScreens(): void {
  useEffect(() => {
    const fit = () => {
      const screen = document.querySelector<HTMLElement>('main.screen');
      if (screen) shrinkToFit(screen, pageOverflows);
      for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) shrinkDialogToFit(dialog);
    };
    const observer = new MutationObserver(fit);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open', 'class', 'disabled'] });
    window.addEventListener('resize', fit);
    document.addEventListener('load', fit, true); // images (the title art) change the height once they arrive
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      document.removeEventListener('load', fit, true);
    };
  }, []);
}
