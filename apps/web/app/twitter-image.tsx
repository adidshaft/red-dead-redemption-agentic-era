import {
  alt,
  contentType,
  renderSocialPreview,
  size,
} from "./social-preview";

export const runtime = "nodejs";

export default async function TwitterImage() {
  return renderSocialPreview();
}
