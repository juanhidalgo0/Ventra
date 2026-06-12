import os
from PIL import Image

source_img_path = r"C:\Users\PC\.gemini\antigravity\brain\0eef1f1a-fb5e-4b01-acbd-7d7978e2cc65\media__1780608701228.jpg"
icons_dir = r"c:\Users\PC\Desktop\Kiosco\src-tauri\icons"

print(f"Opening source image: {source_img_path}")
img = Image.open(source_img_path)
img_rgba = img.convert("RGBA")

# List of png files and their sizes in tauri config
png_configs = {
    "32x32.png": (32, 32),
    "128x128.png": (128, 128),
    "128x128@2x.png": (256, 256),
    "Square30x30Logo.png": (30, 30),
    "Square44x44Logo.png": (44, 44),
    "Square71x71Logo.png": (71, 71),
    "Square89x89Logo.png": (89, 89),
    "Square107x107Logo.png": (107, 107),
    "Square142x142Logo.png": (142, 142),
    "Square150x150Logo.png": (150, 150),
    "Square284x284Logo.png": (284, 284),
    "Square310x310Logo.png": (310, 310),
    "StoreLogo.png": (50, 50),
    "icon.png": (512, 512)
}

# Generate each PNG size
for filename, size in png_configs.items():
    out_path = os.path.join(icons_dir, filename)
    resized = img_rgba.resize(size, Image.Resampling.LANCZOS)
    resized.save(out_path, "PNG")
    print(f"Saved {filename} ({size[0]}x{size[1]})")

# Generate multi-size ICO
ico_path = os.path.join(icons_dir, "icon.ico")
sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img_rgba.save(ico_path, format="ICO", sizes=sizes)
print(f"Saved icon.ico")
