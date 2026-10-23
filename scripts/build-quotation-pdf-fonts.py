"""Build PDF web fonts without losing any TC/HK Unicode coverage.

Requires fonttools. Full TTFs remain the source and network fallback.
TC keeps its complete glyph set; HK contains only code points absent from TC.
"""
from pathlib import Path
import gzip
from fontTools import subset
from fontTools.ttLib import TTFont

directory = Path(__file__).resolve().parents[1] / "public/fonts/pdf"
for weight in ("Regular", "Bold"):
    tc_path = directory / f"NotoSansTC-{weight}.ttf"
    hk_path = directory / f"NotoSansHK-{weight}.ttf"
    tc = TTFont(tc_path)
    hk = TTFont(hk_path)
    tc_codes = set(tc.getBestCmap())
    hk_codes = set(hk.getBestCmap())
    missing = hk_codes - tc_codes

    # Native browser gzip decoding restores the original TTF byte for byte.
    tc_output = directory / f"NotoSansTC-{weight}-v1.ttf.gz"
    tc_output.write_bytes(gzip.compress(tc_path.read_bytes(), compresslevel=9, mtime=0))

    options = subset.Options()
    options.name_IDs = ["*"]  # Keep licensing and attribution.
    options.name_legacy = True
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=missing)
    subsetter.subset(hk)
    hk_output = directory / f"NotoSansHK-Fallback-{weight}-v1.ttf"
    hk.save(hk_output)

    assert gzip.decompress(tc_output.read_bytes()) == tc_path.read_bytes()
    actual_tc = tc_codes
    actual_hk = set(TTFont(hk_output).getBestCmap())
    assert actual_tc == tc_codes
    assert actual_hk == missing
    assert actual_tc | actual_hk == tc_codes | hk_codes
    print(f"{weight}: {len(tc_codes)} TC + {len(missing)} HK fallback code points; "
          f"{tc_output.stat().st_size + hk_output.stat().st_size:,} bytes")
