from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(
    r"C:\Users\Lenovo\AppData\Local\Temp"
    r"\codex-clipboard-a0b37ba2-fd53-48c7-a442-3917adb57139.png"
)
OUTPUT_DIRECTORY = ROOT / "store-assets" / "ads"
OUTPUT = OUTPUT_DIRECTORY / "pi-translator-real-use-redacted.png"


def build_frosted_layer(source: Image.Image) -> Image.Image:
    blurred = source.filter(ImageFilter.GaussianBlur(radius=13))
    cool_white = Image.new("RGBA", source.size, (239, 244, 255, 190))
    frosted = Image.alpha_composite(blurred, cool_white)

    texture = Image.new("RGBA", source.size, (0, 0, 0, 0))
    texture_draw = ImageDraw.Draw(texture)
    for offset in range(-source.height, source.width, 34):
        texture_draw.line(
            (offset, 0, offset + source.height, source.height),
            fill=(79, 70, 229, 9),
            width=1,
        )
    return Image.alpha_composite(frosted, texture)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    width, height = source.size
    if (width, height) != (1126, 739):
        raise ValueError(f"Unexpected screenshot size: {width}x{height}")

    frosted = build_frosted_layer(source)
    redact_mask = Image.new("L", source.size, 0)
    mask_draw = ImageDraw.Draw(redact_mask)

    # Redact only the manuscript/editor area. Keep the gutter and browser UI context.
    mask_draw.rectangle((99, 0, width, height), fill=255)

    # Preserve the full selected passage exactly.
    mask_draw.rectangle((105, 59, 1107, 291), fill=0)

    # Preserve the complete Pi Translator card exactly, including its rounded corners.
    mask_draw.rounded_rectangle((451, 298, 1111, 729), radius=25, fill=0)

    redacted = Image.composite(frosted, source, redact_mask)

    # Add a restrained glass edge around the redacted manuscript area.
    accent = Image.new("RGBA", source.size, (0, 0, 0, 0))
    accent_draw = ImageDraw.Draw(accent)
    accent_draw.line((99, 0, 99, height), fill=(80, 70, 210, 28), width=1)
    redacted = Image.alpha_composite(redacted, accent)

    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    redacted.convert("RGB").save(OUTPUT, format="PNG", optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
