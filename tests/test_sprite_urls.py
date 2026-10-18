from cmeta.dex import sprite_urls


def test_large_images_use_official_illustrations():
    for pokemon_id in (133, 730, 10034):
        urls = sprite_urls(pokemon_id)
        assert urls["artwork"].endswith(f"/other/official-artwork/{pokemon_id}.png")
        assert urls["front"].endswith(f"/pokemon/{pokemon_id}.png")
        assert "home" not in urls


def test_cosmetic_forms_and_missing_ids():
    urls = sprite_urls("1013-masterpiece")
    assert urls["artwork"] is None
    assert urls["front"].endswith("/pokemon/1013-masterpiece.png")
    assert sprite_urls(None) is None
