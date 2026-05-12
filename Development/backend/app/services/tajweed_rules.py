"""
Maps tajweed-aware phonemes (from quranic-phonemizer inventory) to error-type
strings consumed by the mobile UI's getErrorTypeDisplay enum.

Approach (a): the error type is derived purely from the *reference* phoneme that
scored low. We don't yet know what the user said instead, so this attributes
"the rule sitting at this position" rather than "the rule the user violated."
Good enough for v1; revisit when we have a second decode pass for substitutions.

Ghunnah is intentionally skipped: distinguishing a noon/meem that *should* carry
ghunnah from a plain one requires looking at the next phoneme, not just this
one. Tracked as a follow-up.
"""

from typing import Optional


# Source: README.md "Phoneme Inventory" + tokenizer vocab observed in phonemes.json
PHONEME_RULE_MAP: dict[str, str] = {
    # Ikhfaa — noon converted to velar nasal before specific letters
    "ŋ": "missing_ikhfaa",
    "ŋˤ": "missing_ikhfaa",

    # Idgham with ghunnah — noon merging into ي ر م ل و ن
    "ñ": "missing_idgham_ghunnah",
    "m̃": "missing_idgham_ghunnah",
    "j̃": "missing_idgham_ghunnah",
    "w̃": "missing_idgham_ghunnah",

    # Qalqala — echoing on ق ط ب ج د when sakin
    "Q": "missing_qalqala",
    "QQ": "missing_qalqala",

    # Tafkheem — heavy lam (Allah), heavy raa
    "lˤlˤ": "missing_tafkheem",
    "rˤ": "missing_tafkheem",
    "rˤrˤ": "missing_tafkheem",

    # Madd — long vowels
    "a:": "madd_too_short",
    "aˤ:": "madd_too_short",
    "u:": "madd_too_short",
    "i:": "madd_too_short",
}

# Geminate (shaddah) consonants — rendered as doubled phoneme
GEMINATE_PHONEMES = {
    "bb", "tt", "θθ", "ʒʒ", "ħħ", "xx", "dd", "ðð", "rr", "zz", "ss", "ʃʃ",
    "sˤsˤ", "dˤdˤ", "tˤtˤ", "ðˤðˤ", "ʕʕ", "ff", "qq", "kk", "ll", "hh", "ww",
    "jj",
}


def derive_error_type(phoneme: str) -> str:
    """
    Return the error-type string for a low-GoP phoneme. Falls back to
    'missing_shaddah' for any geminate, and 'pronunciation' otherwise.
    """
    if phoneme in PHONEME_RULE_MAP:
        return PHONEME_RULE_MAP[phoneme]
    if phoneme in GEMINATE_PHONEMES:
        return "missing_shaddah"
    return "pronunciation"


def derive_tajweed_rule(phoneme: str) -> Optional[str]:
    """
    Return the rule key (without 'missing_' prefix) that this phoneme
    participates in, regardless of score. Used to annotate graphemes for
    inline UI tinting. Returns None if the phoneme isn't tajweed-bearing.
    """
    err = derive_error_type(phoneme)
    if err == "pronunciation":
        return None
    # 'missing_ikhfaa' -> 'ikhfaa', 'missing_shaddah' -> 'shaddah'
    return err.removeprefix("missing_")
