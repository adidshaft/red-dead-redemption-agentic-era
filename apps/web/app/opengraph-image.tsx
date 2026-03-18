import {
  alt,
  contentType,
  renderSocialPreview,
  size,
} from "./social-preview";

export const runtime = "nodejs";

export default async function OpengraphImage() {
  return renderSocialPreview();
}
