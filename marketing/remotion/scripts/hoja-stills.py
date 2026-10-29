"""Junta los stills de una carpeta en una hoja de contacto: python scripts/hoja-stills.py <carpeta> [columnas]"""
import glob, os, re, sys
from PIL import Image
carpeta = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 5
fs = sorted((f for f in glob.glob(os.path.join(carpeta, 'f*.png'))), key=lambda p: int(re.search(r'f(\d+)\.png$', p).group(1)))
ims = [Image.open(f).convert('RGB') for f in fs]
w, h = ims[0].size
filas = (len(ims) + cols - 1) // cols
hoja = Image.new('RGB', (w * cols, h * filas), 'white')
for i, im in enumerate(ims):
    hoja.paste(im, ((i % cols) * w, (i // cols) * h))
hoja.save(os.path.join(carpeta, 'hoja.png'))
print(len(ims), 'cuadros')
