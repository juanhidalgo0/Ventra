import os
from PIL import Image

# Path to the source logo image (circle version)
source_img_path = r"C:\Users\PC\.gemini\antigravity\brain\0eef1f1a-fb5e-4b01-acbd-7d7978e2cc65\media__1780608701244.jpg"
target_dir = r"c:\Users\PC\Desktop\Kiosco\apps\desktop\build"

# Ensure the target directory exists
os.makedirs(target_dir, exist_ok=True)

# Output paths
png_path = os.path.join(target_dir, "icon.png")
ico_path = os.path.join(target_dir, "icon.ico")

print(f"Opening source image: {source_img_path}")
img = Image.open(source_img_path)

# Convert to RGBA
img_rgba = img.convert("RGBA")

# Resize to 256x256 (standard high-res icon size) for icon.png
img_png = img_rgba.resize((256, 256), Image.Resampling.LANCZOS)
img_png.save(png_path, "PNG")
print(f"Saved PNG icon to: {png_path}")

# Save as multi-size ICO
sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img_rgba.save(ico_path, format="ICO", sizes=sizes)
print(f"Saved ICO icon to: {ico_path}")
