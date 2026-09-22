"""PNG → WebP для встраивания в страницы: python3 tools/webp.py"""
import os, glob
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '..', 'shots')
for f in sorted(glob.glob(os.path.join(SHOTS, '*.png'))):
    if os.path.basename(f).startswith('_'): continue
    im = Image.open(f).convert('RGB')
    name = os.path.basename(f)[:-4]
    # Длинные страницы обрезаются до читаемой верхней части
    if name in ('super-mailbox', 'super-mail'):
        im = im.crop((0, 0, im.width, min(im.height, 760)))
    im.save(f[:-4] + '.webp', 'WEBP', quality=84, method=6)
    print(name, os.path.getsize(f[:-4] + '.webp') // 1024, 'KB')
