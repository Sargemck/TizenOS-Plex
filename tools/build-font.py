"""Build a static, offline Japanese font from Google's OFL-licensed Noto Sans JP.

Usage: python tools/build-font.py source.ttf app/japanese.woff2
Requires fonttools and brotli. The Japanese build retains its full character map.
Optional --supplement mode keeps common Han characters absent from the base font.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

font = TTFont(sys.argv[1])
if "fvar" in font:
    font = instantiateVariableFont(font, {"wght": 500}, inplace=True)
supplement = len(sys.argv) > 4 and sys.argv[4] == '--supplement'
if supplement:
    repertoire = set(range(0x4E00,0xA000)) - set(TTFont(sys.argv[3]).getBestCmap())
    options = subset.Options()
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=repertoire)
    sub.subset(font)
elif len(sys.argv) > 3:
    # Preserve every character in Google's Japanese distribution plus the complete
    # basic Han block, punctuation and compatibility forms. Drop unrelated scripts.
    repertoire = set(TTFont(sys.argv[3]).getBestCmap())
    for first, last in [(0x20,0xFF),(0x2E80,0x31FF),(0x4E00,0x9FFF),(0xF900,0xFAFF),(0xFE00,0xFFFF)]:
        repertoire.update(range(first,last+1))
    options = subset.Options()
    options.layout_scripts = ['hani','kana','latn']
    options.layout_languages = ['JAN ','ZHS ','ZHT ','dflt']
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=repertoire)
    sub.subset(font)
for record in font["name"].names:
    replacements = {1: "TizenOS Plex Japanese", 2: "Regular", 4: "TizenOS Plex Japanese", 6: "TizenOSPlexJapanese-Regular", 16: "TizenOS Plex Japanese", 17: "Regular"}
    if record.nameID in replacements:
        record.string = replacements[record.nameID].encode(record.getEncoding())
font.flavor = "woff2"
font.save(sys.argv[2])
required = "简" if supplement else "日本語の字幕ひらがなカタカナ漢字"
missing = [c for c in required if ord(c) not in font.getBestCmap()]
if missing:
    raise RuntimeError("Missing test glyphs: " + "".join(missing))
print("Japanese and Chinese sample glyphs verified; retained",len(font.getBestCmap()),"characters.")
