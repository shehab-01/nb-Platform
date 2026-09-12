// The one message the store form and the /preview frame exchange. Its own
// module so the admin can name it without pulling the preview page (and the
// template registry behind it) into the admin bundle.

/** Parent → frame: `{type, content: {key: url}}` swaps the pictures shown.
 *  Frame → parent: `${PREVIEW_MESSAGE}-ready` once it can take them. */
export const PREVIEW_MESSAGE = "nb-preview-content";
