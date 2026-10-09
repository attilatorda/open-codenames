/** Where the UI loads a picture from: the oc-img protocol on desktop, a static file on the web. */
export const imageSrc = (imageId: string): string => window.oc.images.url(imageId);
