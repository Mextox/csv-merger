# -*- coding: utf-8 -*-
"""
يولّد ملفات اختبار فك تشفير Excel (تُشغَّل مرة واحدة ثم تُحفظ الملفات الناتجة في المستودع):

    python tests/fixtures/make-encrypted.py

المتطلبات: openpyxl و msoffcrypto-tool (ومعه olefile).

الناتج (بجانب هذا الملف):
  - plain.xlsx                      مصنّف صغير: ورقة "Cards" بأرقام وهمية
  - encrypted-agile.xlsx            نفس المصنّف مشفّرًا (Agile: SHA-512، spinCount=100000، AES-256) بكلمة السر Tamim-123
  - encrypted-agile.decrypted.xlsx  ناتج فك التشفير بـ msoffcrypto (مرجع مستقل لمقارنة ناتجنا)
  - encrypted-agile.streams.json    قائمة تيارات OLE كما يقرؤها olefile (مرجع مستقل لقارئ ole.js)
  - encrypted-agile-ar.xlsx         نفس المصنّف بكلمة سر عربية وspinCount=1000 (يتحقق من ترميز UTF-16LE
                                    ومن قراءة spinCount من الملف لا افتراضه)

كل الأرقام وهمية — لا بيانات حقيقية.
"""
import hashlib
import io
import json
import os

import msoffcrypto
import olefile
from msoffcrypto.format.ooxml import OOXMLFile
from msoffcrypto.method.ecma376_agile import ECMA376Agile
from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))
PASSWORD = "Tamim-123"
PASSWORD_AR = "سرّي-Tamim-٤٥٦"

PLAIN = os.path.join(HERE, "plain.xlsx")
ENCRYPTED = os.path.join(HERE, "encrypted-agile.xlsx")
DECRYPTED = os.path.join(HERE, "encrypted-agile.decrypted.xlsx")
STREAMS = os.path.join(HERE, "encrypted-agile.streams.json")
ENCRYPTED_AR = os.path.join(HERE, "encrypted-agile-ar.xlsx")


def build_plain():
    wb = Workbook()
    ws = wb.active
    ws.title = "Cards"
    ws.append(["PIN", "SN", "Value"])
    # أرقام وهمية مخزّنة كنصوص (منها سري يبدأ بصفر)، وخلية رقمية واحدة في آخر صف
    ws.append(["0012345678901234", "900000000001", "10"])
    ws.append(["1234567890123456", "900000000002", "20"])
    ws.append(["9876543210987654", "900000000003", 50])
    wb.save(PLAIN)


def encrypt():
    with open(PLAIN, "rb") as src, open(ENCRYPTED, "wb") as out:
        OOXMLFile(src).encrypt(PASSWORD, out)


def encrypt_arabic():
    with open(PLAIN, "rb") as src:
        data = ECMA376Agile.encrypt(PASSWORD_AR, src, spin_count=1000)
    with open(ENCRYPTED_AR, "wb") as out:
        out.write(data)


def msoffcrypto_decrypt(path, password):
    with open(path, "rb") as src:
        office = msoffcrypto.OfficeFile(src)
        office.load_key(password=password)
        out = io.BytesIO()
        office.decrypt(out)
    return out.getvalue()


def decrypt_reference():
    with open(DECRYPTED, "wb") as out:
        out.write(msoffcrypto_decrypt(ENCRYPTED, PASSWORD))


def dump_streams():
    ole = olefile.OleFileIO(ENCRYPTED)
    try:
        streams = {}
        for path in ole.listdir(streams=True, storages=False):
            data = ole.openstream(path).read()
            streams["/".join(path)] = {
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "mini": ole.get_size(path) < ole.minisectorcutoff,
            }
        info = {"sectorSize": ole.sector_size, "streams": streams}
    finally:
        ole.close()
    with open(STREAMS, "w", encoding="utf-8", newline="\n") as f:
        json.dump(info, f, indent=2, sort_keys=True)
        f.write("\n")


def main():
    build_plain()
    encrypt()
    encrypt_arabic()
    decrypt_reference()
    dump_streams()
    with open(PLAIN, "rb") as a, open(DECRYPTED, "rb") as b:
        same = a.read() == b.read()
    print("plain.xlsx:", os.path.getsize(PLAIN), "bytes")
    print("encrypted-agile.xlsx:", os.path.getsize(ENCRYPTED), "bytes")
    print("msoffcrypto decrypt == plain:", same)
    if not same:
        raise SystemExit("msoffcrypto decrypt does not reproduce plain.xlsx")
    with open(PLAIN, "rb") as a:
        same_ar = a.read() == msoffcrypto_decrypt(ENCRYPTED_AR, PASSWORD_AR)
    print("arabic-password file decrypts to plain:", same_ar)
    if not same_ar:
        raise SystemExit("msoffcrypto decrypt of encrypted-agile-ar.xlsx does not reproduce plain.xlsx")


if __name__ == "__main__":
    main()
