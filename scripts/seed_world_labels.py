#!/usr/bin/env python3
"""
seed_world_labels.py — Generate the bundled starter offline world labels SQLite DB
(`data/labels-world-base.db`) and a sample importable regional label pack
(`data/samples/amsterdam-labels.rlp`).

Produces an R*Tree-indexed SQLite database conforming identically to
`scripts/build_world_labels.py` and `main/gis/services/labelDatabaseService.js`,
with authentic native, English, and Arabic place names across every continent
so Offline Map Labels and Offline Place Search work immediately out of the box.

Users can replace `data/labels-world-base.db` at any time with a full GeoNames
or OpenStreetMap PBF extract using `scripts/build_world_labels.py`.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import List, Tuple

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASE_DB = ROOT / "data" / "labels-world-base.db"
DEFAULT_SAMPLE_RLP = ROOT / "data" / "samples" / "amsterdam-labels.rlp"

# (name_native, name_en, name_ar, type, lat, lon, min_zoom, max_zoom, population, importance)
WORLD_LABELS: List[Tuple[str, str, str, str, float, float, int, int, int, float]] = [
    # ── Countries (min_zoom 1–3) ──
    ("United States", "United States", "الولايات المتحدة", "country", 39.8283, -98.5795, 1, 6, 333000000, 1.00),
    ("Canada", "Canada", "كندا", "country", 56.1304, -106.3468, 1, 6, 39500000, 0.96),
    ("México", "Mexico", "المكسيك", "country", 23.6345, -102.5528, 2, 6, 128900000, 0.95),
    ("Brasil", "Brazil", "البرازيل", "country", -14.2350, -51.9253, 1, 6, 214300000, 0.98),
    ("Argentina", "Argentina", "الأرجنتين", "country", -38.4161, -63.6167, 2, 6, 45800000, 0.93),
    ("Colombia", "Colombia", "كولومبيا", "country", 4.5709, -74.2973, 2, 6, 51800000, 0.90),
    ("Chile", "Chile", "تشيلي", "country", -35.6751, -71.5430, 2, 6, 19600000, 0.88),
    ("United Kingdom", "United Kingdom", "المملكة المتحدة", "country", 54.7024, -3.2766, 2, 6, 67700000, 0.96),
    ("France", "France", "فرنسا", "country", 46.2276, 2.2137, 2, 6, 68000000, 0.96),
    ("Deutschland", "Germany", "ألمانيا", "country", 51.1657, 10.4515, 2, 6, 84400000, 0.97),
    ("Nederland", "Netherlands", "هولندا", "country", 52.1326, 5.2913, 3, 7, 17900000, 0.92),
    ("België / Belgique", "Belgium", "بلجيكا", "country", 50.5039, 4.4699, 3, 7, 11700000, 0.88),
    ("España", "Spain", "إسبانيا", "country", 40.4637, -3.7492, 2, 6, 48000000, 0.94),
    ("Portugal", "Portugal", "البرتغال", "country", 39.3999, -8.2245, 3, 7, 10400000, 0.87),
    ("Italia", "Italy", "إيطاليا", "country", 41.8719, 12.5674, 2, 6, 58900000, 0.95),
    ("Schweiz / Suisse", "Switzerland", "سويسرا", "country", 46.8182, 8.2275, 3, 7, 8800000, 0.89),
    ("Österreich", "Austria", "النمسا", "country", 47.5162, 14.5501, 3, 7, 9100000, 0.88),
    ("Polska", "Poland", "بولندا", "country", 51.9194, 19.1451, 2, 6, 37700000, 0.92),
    ("Sverige", "Sweden", "السويد", "country", 60.1282, 18.6435, 2, 6, 10500000, 0.89),
    ("Norge", "Norway", "النرويج", "country", 60.4720, 8.4689, 2, 6, 5500000, 0.88),
    ("Ελλάδα", "Greece", "اليونان", "country", 39.0742, 21.8243, 3, 7, 10400000, 0.89),
    ("Türkiye", "Turkey", "تركيا", "country", 38.9637, 35.2433, 2, 6, 85300000, 0.95),
    ("مصر", "Egypt", "مصر", "country", 26.8206, 30.8025, 2, 6, 111000000, 0.96),
    ("المملكة العربية السعودية", "Saudi Arabia", "المملكة العربية السعودية", "country", 23.8859, 45.0792, 2, 6, 36900000, 0.96),
    ("الإمارات العربية المتحدة", "United Arab Emirates", "الإمارات العربية المتحدة", "country", 23.4241, 53.8478, 3, 7, 9900000, 0.93),
    ("الأردن", "Jordan", "الأردن", "country", 30.5852, 36.2384, 3, 7, 11300000, 0.89),
    ("قطر", "Qatar", "قطر", "country", 25.3548, 51.1839, 3, 8, 2900000, 0.88),
    ("الكويت", "Kuwait", "الكويت", "country", 29.3117, 47.4818, 3, 8, 4300000, 0.87),
    ("عُمان", "Oman", "عُمان", "country", 21.4735, 55.9754, 3, 7, 4600000, 0.87),
    ("المغرب", "Morocco", "المغرب", "country", 31.7917, -7.0926, 2, 6, 37500000, 0.92),
    ("الجزائر", "Algeria", "الجزائر", "country", 28.0339, 1.6596, 2, 6, 45600000, 0.92),
    ("تونس", "Tunisia", "تونس", "country", 33.8869, 9.5375, 3, 7, 12400000, 0.88),
    ("العراق", "Iraq", "العراق", "country", 33.2232, 43.6793, 2, 6, 44500000, 0.91),
    ("لبنان", "Lebanon", "لبنان", "country", 33.8547, 35.8623, 3, 8, 5500000, 0.87),
    ("Nigeria", "Nigeria", "نيجيريا", "country", 9.0820, 8.6753, 2, 6, 223800000, 0.95),
    ("Kenya", "Kenya", "كينيا", "country", -0.0236, 37.9062, 2, 6, 55100000, 0.91),
    ("South Africa", "South Africa", "جنوب أفريقيا", "country", -30.5595, 22.9375, 2, 6, 60400000, 0.94),
    ("भारत", "India", "الهند", "country", 20.5937, 78.9629, 1, 6, 1428000000, 1.00),
    ("中国", "China", "الصين", "country", 35.8617, 104.1954, 1, 6, 1412000000, 1.00),
    ("日本", "Japan", "اليابان", "country", 36.2048, 138.2529, 2, 6, 124500000, 0.97),
    ("대한민국", "South Korea", "كوريا الجنوبية", "country", 35.9078, 127.7669, 3, 7, 51700000, 0.94),
    ("Indonesia", "Indonesia", "إندونيسيا", "country", -0.7893, 113.9213, 2, 6, 277500000, 0.96),
    ("Australia", "Australia", "أستراليا", "country", -25.2744, 133.7751, 1, 6, 26600000, 0.96),
    ("New Zealand", "New Zealand", "نيوزيلندا", "country", -40.9006, 174.8860, 2, 6, 5200000, 0.88),

    # ── States / Provinces / Regions (min_zoom 4–6) ──
    ("Noord-Holland", "North Holland", "شمال هولندا", "state", 52.5206, 4.7885, 5, 10, 2950000, 0.78),
    ("Zuid-Holland", "South Holland", "جنوب هولندا", "state", 52.0208, 4.4938, 5, 10, 3800000, 0.78),
    ("Utrecht", "Utrecht Province", "مقاطعة أوتريخت", "state", 52.0907, 5.1214, 6, 10, 1390000, 0.74),
    ("California", "California", "كاليفورنيا", "state", 36.7783, -119.4179, 4, 8, 39000000, 0.85),
    ("New York", "New York State", "ولاية نيويورك", "state", 42.9538, -75.5268, 4, 8, 19600000, 0.84),
    ("Pennsylvania", "Pennsylvania", "بنسيلفانيا", "state", 41.2033, -77.1945, 4, 8, 13000000, 0.81),
    ("Texas", "Texas", "تكساس", "state", 31.9686, -99.9018, 4, 8, 30500000, 0.84),
    ("Bayern", "Bavaria", "بافاريا", "state", 48.7904, 11.4979, 5, 9, 13400000, 0.80),
    ("Île-de-France", "Ile-de-France", "إيل دو فرانس", "state", 48.8499, 2.6370, 5, 9, 12300000, 0.81),
    ("منطقة الرياض", "Riyadh Province", "منطقة الرياض", "state", 24.7000, 46.5000, 4, 8, 8600000, 0.82),
    ("منطقة مكة المكرمة", "Makkah Province", "منطقة مكة المكرمة", "state", 21.5000, 40.2000, 4, 8, 8000000, 0.82),
    ("إمارة دبي", "Emirate of Dubai", "إمارة دبي", "state", 25.0750, 55.3090, 5, 9, 3600000, 0.82),
    ("إمارة أبوظبي", "Emirate of Abu Dhabi", "إمارة أبوظبي", "state", 23.6500, 54.0000, 5, 9, 3700000, 0.82),

    # ── Major Global Cities & Capitals (min_zoom 3–6) ──
    ("Amsterdam", "Amsterdam", "أمستردام", "city", 52.3676, 4.9041, 3, 16, 921000, 0.95),
    ("Rotterdam", "Rotterdam", "روتردام", "city", 51.9244, 4.4777, 5, 16, 664000, 0.86),
    ("Den Haag", "The Hague", "لاهاي", "city", 52.0705, 4.3007, 5, 16, 562000, 0.87),
    ("Utrecht", "Utrecht", "أوتريخت", "city", 52.0907, 5.1214, 6, 16, 368000, 0.82),
    ("Eindhoven", "Eindhoven", "آيندهوفن", "city", 51.4416, 5.4697, 6, 16, 243000, 0.79),
    ("Haarlem", "Haarlem", "هارلم", "city", 52.3874, 4.6462, 7, 16, 165000, 0.75),
    ("Delft", "Delft", "دلفت", "city", 52.0116, 4.3571, 7, 16, 106000, 0.74),
    ("London", "London", "لندن", "city", 51.5074, -0.1278, 3, 16, 8980000, 0.99),
    ("Paris", "Paris", "باريس", "city", 48.8566, 2.3522, 3, 16, 2160000, 0.99),
    ("Berlin", "Berlin", "برلين", "city", 52.5200, 13.4050, 3, 16, 3755000, 0.97),
    ("München", "Munich", "ميونخ", "city", 48.1351, 11.5820, 4, 16, 1510000, 0.90),
    ("Frankfurt am Main", "Frankfurt", "فرانكفورت", "city", 50.1109, 8.6821, 5, 16, 773000, 0.88),
    ("Bruxelles", "Brussels", "بروكسل", "city", 50.8503, 4.3517, 4, 16, 1220000, 0.92),
    ("Madrid", "Madrid", "مدريد", "city", 40.4168, -3.7038, 3, 16, 3330000, 0.96),
    ("Barcelona", "Barcelona", "برشلونة", "city", 41.3874, 2.1686, 4, 16, 1660000, 0.93),
    ("Lisboa", "Lisbon", "لشبونة", "city", 38.7223, -9.1393, 4, 16, 548000, 0.90),
    ("Roma", "Rome", "روما", "city", 41.9028, 12.4964, 3, 16, 2870000, 0.97),
    ("Milano", "Milan", "ميلانو", "city", 45.4642, 9.1900, 4, 16, 1396000, 0.92),
    ("Zürich", "Zurich", "زيورخ", "city", 47.3769, 8.5417, 4, 16, 443000, 0.90),
    ("Genève", "Geneva", "جنيف", "city", 46.2044, 6.1432, 5, 16, 204000, 0.88),
    ("Wien", "Vienna", "فيينا", "city", 48.2082, 16.3738, 4, 16, 1982000, 0.93),
    ("Praha", "Prague", "براغ", "city", 50.0755, 14.4378, 4, 16, 1357000, 0.91),
    ("Warszawa", "Warsaw", "وارسو", "city", 52.2297, 21.0122, 4, 16, 1860000, 0.92),
    ("Stockholm", "Stockholm", "ستوكهولم", "city", 59.3293, 18.0686, 4, 16, 984000, 0.91),
    ("Oslo", "Oslo", "أوسلو", "city", 59.9139, 10.7522, 4, 16, 709000, 0.89),
    ("København", "Copenhagen", "كوبنهاغن", "city", 55.6761, 12.5683, 4, 16, 653000, 0.90),
    ("Dublin", "Dublin", "دبلن", "city", 53.3498, -6.2603, 4, 16, 592000, 0.89),
    ("Αθήνα", "Athens", "أثينا", "city", 37.9838, 23.7275, 4, 16, 3150000, 0.93),
    ("İstanbul", "Istanbul", "إسطنبول", "city", 41.0082, 28.9784, 3, 16, 15900000, 0.98),
    ("Ankara", "Ankara", "أنقرة", "city", 39.9334, 32.8597, 4, 16, 5780000, 0.92),

    # Middle East & North Africa
    ("الرياض", "Riyadh", "الرياض", "city", 24.7136, 46.6753, 3, 16, 7676000, 0.97),
    ("جدة", "Jeddah", "جدة", "city", 21.4858, 39.1925, 4, 16, 4697000, 0.93),
    ("مكة المكرمة", "Mecca", "مكة المكرمة", "city", 21.3891, 39.8579, 4, 16, 2385000, 0.95),
    ("المدينة المنورة", "Medina", "المدينة المنورة", "city", 24.5247, 39.5692, 4, 16, 1488000, 0.92),
    ("الدمام", "Dammam", "الدمام", "city", 26.4207, 50.0888, 5, 16, 1386000, 0.87),
    ("دبي", "Dubai", "دبي", "city", 25.2048, 55.2708, 3, 16, 3600000, 0.97),
    ("أبوظبي", "Abu Dhabi", "أبوظبي", "city", 24.4539, 54.3773, 4, 16, 1540000, 0.94),
    ("الشارقة", "Sharjah", "الشارقة", "city", 25.3463, 55.4209, 6, 16, 1800000, 0.85),
    ("الدوحة", "Doha", "الدوحة", "city", 25.2854, 51.5310, 4, 16, 1186000, 0.93),
    ("مدينة الكويت", "Kuwait City", "مدينة الكويت", "city", 29.3759, 47.9774, 4, 16, 3100000, 0.91),
    ("مسقط", "Muscat", "مسقط", "city", 23.5880, 58.3829, 4, 16, 1620000, 0.90),
    ("المنامة", "Manama", "المنامة", "city", 26.2285, 50.5860, 5, 16, 635000, 0.88),
    ("القاهرة", "Cairo", "القاهرة", "city", 30.0444, 31.2357, 3, 16, 21750000, 0.99),
    ("الإسكندرية", "Alexandria", "الإسكندرية", "city", 31.2001, 29.9187, 4, 16, 5580000, 0.92),
    ("عمّان", "Amman", "عمّان", "city", 31.9454, 35.9284, 4, 16, 4060000, 0.93),
    ("القدس", "Jerusalem", "القدس", "city", 31.7683, 35.2137, 4, 16, 971000, 0.94),
    ("תל אביב", "Tel Aviv", "تل أبيب", "city", 32.0853, 34.7818, 5, 16, 474000, 0.90),
    ("חיפה", "Haifa", "حيفا", "city", 32.7940, 34.9896, 6, 16, 290000, 0.84),
    ("بيروت", "Beirut", "بيروت", "city", 33.8938, 35.5018, 4, 16, 2420000, 0.91),
    ("بغداد", "Baghdad", "بغداد", "city", 33.3152, 44.3661, 3, 16, 7710000, 0.94),
    ("الدار البيضاء", "Casablanca", "الدار البيضاء", "city", 33.5731, -7.5898, 4, 16, 3840000, 0.92),
    ("الرباط", "Rabat", "الرباط", "city", 34.0209, -6.8416, 4, 16, 1930000, 0.90),
    ("مراكش", "Marrakesh", "مراكش", "city", 31.6295, -7.9811, 5, 16, 1050000, 0.88),
    ("الجزائر", "Algiers", "الجزائر العاصمة", "city", 36.7538, 3.0588, 4, 16, 2915000, 0.91),
    ("تونس", "Tunis", "تونس العاصمة", "city", 36.8065, 10.1815, 4, 16, 2440000, 0.90),

    # Americas
    ("New York", "New York", "نيويورك", "city", 40.7128, -74.0060, 3, 16, 8336000, 1.00),
    ("Philadelphia", "Philadelphia", "فيلادلفيا", "city", 39.9526, -75.1652, 4, 16, 1567000, 0.92),
    ("Washington, D.C.", "Washington, D.C.", "واشنطن العاصمة", "city", 38.9072, -77.0369, 3, 16, 689000, 0.96),
    ("Boston", "Boston", "بوسطن", "city", 42.3601, -71.0589, 4, 16, 675000, 0.90),
    ("Chicago", "Chicago", "شيكاغو", "city", 41.8781, -87.6298, 3, 16, 2665000, 0.95),
    ("Los Angeles", "Los Angeles", "لوس أنجلوس", "city", 34.0522, -118.2437, 3, 16, 3822000, 0.98),
    ("San Francisco", "San Francisco", "سان فرانسيسكو", "city", 37.7749, -122.4194, 4, 16, 808000, 0.94),
    ("Seattle", "Seattle", "سياتل", "city", 47.6062, -122.3321, 4, 16, 749000, 0.90),
    ("Houston", "Houston", "هيوستن", "city", 29.7604, -95.3698, 4, 16, 2304000, 0.91),
    ("Miami", "Miami", "ميامي", "city", 25.7617, -80.1918, 4, 16, 449000, 0.90),
    ("Denver", "Denver", "دنفر", "city", 39.7392, -104.9903, 4, 16, 713000, 0.88),
    ("Toronto", "Toronto", "تورونتو", "city", 43.6532, -79.3832, 3, 16, 2794000, 0.95),
    ("Vancouver", "Vancouver", "فانكوفر", "city", 49.2827, -123.1207, 4, 16, 662000, 0.90),
    ("Montréal", "Montreal", "مونتريال", "city", 45.5017, -73.5673, 4, 16, 1762000, 0.91),
    ("Ciudad de México", "Mexico City", "مكسيكو سيتي", "city", 19.4326, -99.1332, 3, 16, 9210000, 0.98),
    ("São Paulo", "Sao Paulo", "ساو باولو", "city", -23.5505, -46.6333, 3, 16, 11450000, 0.98),
    ("Rio de Janeiro", "Rio de Janeiro", "ريو دي جانيرو", "city", -22.9068, -43.1729, 4, 16, 6211000, 0.95),
    ("Buenos Aires", "Buenos Aires", "بوينس آيرس", "city", -34.6037, -58.3816, 3, 16, 3120000, 0.96),
    ("Bogotá", "Bogota", "بوغوتا", "city", 4.7110, -74.0721, 4, 16, 7900000, 0.93),
    ("Lima", "Lima", "ليما", "city", -12.0464, -77.0428, 4, 16, 9750000, 0.93),
    ("Santiago", "Santiago", "سانتياغو", "city", -33.4489, -70.6693, 4, 16, 6260000, 0.93),

    # Asia-Pacific & Africa
    ("東京", "Tokyo", "طوكيو", "city", 35.6762, 139.6503, 3, 16, 14040000, 1.00),
    ("大阪", "Osaka", "أوساكا", "city", 34.6937, 135.5023, 4, 16, 2750000, 0.93),
    ("서울", "Seoul", "سيول", "city", 37.5665, 126.9780, 3, 16, 9428000, 0.98),
    ("北京", "Beijing", "بكين", "city", 39.9042, 116.4074, 3, 16, 21890000, 0.99),
    ("上海", "Shanghai", "شنغهاي", "city", 31.2304, 121.4737, 3, 16, 24870000, 0.99),
    ("香港", "Hong Kong", "هونغ كونغ", "city", 22.3193, 114.1694, 4, 16, 7498000, 0.95),
    ("臺北", "Taipei", "تايبيه", "city", 25.0330, 121.5654, 4, 16, 2500000, 0.92),
    ("Singapore", "Singapore", "سنغافورة", "city", 1.3521, 103.8198, 3, 16, 5917000, 0.97),
    ("กรุงเทพมหานคร", "Bangkok", "بانكوك", "city", 13.7563, 100.5018, 3, 16, 10539000, 0.96),
    ("Kuala Lumpur", "Kuala Lumpur", "كوالالمبور", "city", 3.1390, 101.6869, 4, 16, 1982000, 0.92),
    ("Jakarta", "Jakarta", "جاكرتا", "city", -6.2088, 106.8456, 3, 16, 10560000, 0.96),
    ("Manila", "Manila", "مانيلا", "city", 14.5995, 120.9842, 4, 16, 1846000, 0.93),
    ("नई दिल्ली", "New Delhi", "نيودلهي", "city", 28.6139, 77.2090, 3, 16, 16780000, 0.98),
    ("मुंबई", "Mumbai", "مومباي", "city", 19.0760, 72.8777, 3, 16, 12440000, 0.97),
    ("बेंगलुरु", "Bengaluru", "بنغالور", "city", 12.9716, 77.5946, 4, 16, 8443000, 0.93),
    ("Sydney", "Sydney", "سيدني", "city", -33.8688, 151.2093, 3, 16, 5312000, 0.96),
    ("Melbourne", "Melbourne", "ملبورن", "city", -37.8136, 144.9631, 4, 16, 5078000, 0.94),
    ("Auckland", "Auckland", "أوكلاند", "city", -36.8485, 174.7633, 4, 16, 1652000, 0.90),
    ("Lagos", "Lagos", "لاغوس", "city", 6.5244, 3.3792, 3, 16, 15380000, 0.95),
    ("Nairobi", "Nairobi", "نيروبي", "city", -1.2921, 36.8219, 4, 16, 4397000, 0.92),
    ("Addis Ababa", "Addis Ababa", "أديس أبابا", "city", 9.0320, 38.7469, 4, 16, 3860000, 0.91),
    ("Johannesburg", "Johannesburg", "جوهانسبرغ", "city", -26.2041, 28.0473, 4, 16, 5635000, 0.93),
    ("Cape Town", "Cape Town", "كيب تاون", "city", -33.9249, 18.4241, 4, 16, 4618000, 0.93),

    # ── Major Water Bodies, Mountains & Transport (zoom_min 2–12) ──
    ("Mediterranean Sea", "Mediterranean Sea", "البحر الأبيض المتوسط", "lake", 35.0000, 18.0000, 2, 7, 0, 0.85),
    ("Red Sea", "Red Sea", "البحر الأحمر", "lake", 20.2802, 38.5126, 3, 8, 0, 0.82),
    ("Arabian Gulf", "Arabian Gulf", "الخليج العربي", "lake", 26.7500, 51.5000, 3, 8, 0, 0.82),
    ("North Sea", "North Sea", "بحر الشمال", "lake", 56.0000, 3.0000, 3, 8, 0, 0.82),
    ("IJsselmeer", "IJsselmeer", "بحيرة آيسلمير", "lake", 52.7333, 5.3167, 7, 13, 0, 0.72),
    ("Mont Blanc", "Mont Blanc", "جبل مون بلان", "mountain", 45.8326, 6.8652, 6, 15, 0, 0.80),
    ("富士山", "Mount Fuji", "جبل فوجي", "mountain", 35.3606, 138.7274, 6, 15, 0, 0.83),

    # ── Local Campus & City Detail (Amsterdam — pairs with bundled Sample 3D Tileset) ──
    ("Amsterdam Centrum", "Amsterdam Centrum", "وسط أمستردام", "suburb", 52.3702, 4.8952, 11, 18, 87000, 0.74),
    ("Oosterdok", "Oosterdok", "أوستردوك", "suburb", 52.3749, 4.9095, 12, 18, 12000, 0.72),
    ("Zuidas", "Zuidas", "زويداس", "suburb", 52.3382, 4.8731, 11, 18, 28000, 0.73),
    ("Amstel", "Amstel River", "نهر أمستل", "waterway", 52.3652, 4.9018, 12, 18, 0, 0.70),
    ("Meridian Survey Campus", "Meridian Survey Campus", "حرم ميريديان للمساحة", "poi", 52.3676, 4.9041, 11, 22, 0, 0.90),
    ("Amsterdam Centraal", "Amsterdam Central Station", "محطة أمستردام المركزية", "railway", 52.3791, 4.9003, 12, 20, 0, 0.82),
    ("Schiphol Airport", "Amsterdam Airport Schiphol", "مطار سخيبول أمستردام", "airport", 52.3105, 4.7683, 10, 18, 0, 0.84),
]

AMSTERDAM_PACK_LABELS: List[Tuple[str, str, str, str, float, float, int, int, int, float]] = [
    ("Jordaan", "Jordaan", "يوردان", "suburb", 52.3738, 4.8809, 12, 20, 19500, 0.76),
    ("De Pijp", "De Pijp", "دي بايب", "suburb", 52.3536, 4.8947, 12, 20, 34000, 0.76),
    ("Amsterdam-Noord", "Amsterdam North", "شمال أمستردام", "suburb", 52.3933, 4.9183, 11, 20, 105000, 0.78),
    ("Museumplein", "Museum Quarter", "ساحة المتاحف", "poi", 52.3579, 4.8813, 13, 22, 0, 0.82),
    ("Rijksmuseum", "Rijksmuseum", "متحف ريكز", "poi", 52.3600, 4.8852, 14, 22, 0, 0.84),
    ("Vondelpark", "Vondelpark", "حديقة فوندل", "poi", 52.3580, 4.8686, 13, 22, 0, 0.81),
    ("NEMO Science Museum", "NEMO Science Museum", "متحف نيمو للعلوم", "poi", 52.3742, 4.9123, 14, 22, 0, 0.80),
    ("Universiteit van Amsterdam", "University of Amsterdam", "جامعة أمستردام", "school", 52.3687, 4.8904, 14, 22, 0, 0.79),
    ("OLVG Oost", "OLVG East Hospital", "مستشفى أولفيغ الشرق", "hospital", 52.3568, 4.9167, 14, 22, 0, 0.77),
    ("Damrak", "Damrak", "دامراك", "road", 52.3755, 4.8955, 14, 22, 0, 0.72),
    ("Ringweg A10", "A10 Ring Motorway", "الطريق الدائري A10", "motorway", 52.3389, 4.8912, 12, 20, 0, 0.76),
    ("Prinsengracht", "Prinsengracht Canal", "قناة برينسنغراخت", "waterway", 52.3663, 4.8837, 13, 22, 0, 0.75),
    ("Herengracht", "Herengracht Canal", "قناة هيرنغراخت", "waterway", 52.3679, 4.8891, 13, 22, 0, 0.75),
    ("Keizersgracht", "Keizersgracht Canal", "قناة كايزرسغراخت", "waterway", 52.3669, 4.8866, 13, 22, 0, 0.75),
    ("IJ", "IJ Waterfront", "مضيق آي", "waterway", 52.3822, 4.9061, 12, 20, 0, 0.77),
]


def _write_label_db(db_path: Path, rows: List[Tuple], meta: dict) -> int:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(
            """
            PRAGMA journal_mode = DELETE;
            PRAGMA synchronous = FULL;

            CREATE TABLE meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE labels (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                name_en    TEXT,
                name_ar    TEXT,
                name_local TEXT,
                type       TEXT NOT NULL,
                subtype    TEXT,
                priority   INTEGER NOT NULL DEFAULT 50,
                lon        REAL NOT NULL,
                lat        REAL NOT NULL,
                zoom_min   INTEGER NOT NULL DEFAULT 0,
                zoom_max   INTEGER NOT NULL DEFAULT 22,
                population INTEGER NOT NULL DEFAULT 0
            );

            CREATE VIRTUAL TABLE labels_rtree USING rtree(
                id,
                bbox_west, bbox_east,
                bbox_south, bbox_north
            );

            CREATE INDEX idx_labels_zoom_type ON labels(zoom_min, zoom_max, type);
            CREATE INDEX idx_labels_priority ON labels(priority DESC, population DESC);
            CREATE INDEX idx_labels_name ON labels(name COLLATE NOCASE);
            CREATE INDEX idx_labels_name_en ON labels(name_en COLLATE NOCASE);
            """
        )

        with conn:
            for k, v in meta.items():
                conn.execute("INSERT INTO meta(key, value) VALUES(?, ?)", (str(k), str(v)))

            for name, name_en, name_ar, ltype, lat, lon, min_z, max_z, pop, imp in rows:
                priority = max(1, min(100, int(round(imp * 100))))
                cur = conn.execute(
                    """
                    INSERT INTO labels(
                        name, name_en, name_ar, name_local,
                        type, subtype, priority, lon, lat,
                        zoom_min, zoom_max, population
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (name, name_en, name_ar, name, ltype, ltype, priority, lon, lat, min_z, max_z, pop),
                )
                row_id = cur.lastrowid
                conn.execute(
                    "INSERT INTO labels_rtree(id, bbox_west, bbox_east, bbox_south, bbox_north) VALUES (?, ?, ?, ?, ?)",
                    (row_id, lon, lon, lat, lat),
                )

        conn.execute("VACUUM")
        return len(rows)
    finally:
        conn.close()


def build_sample_rlp(rlp_path: Path) -> dict:
    rlp_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_db = Path(tmp) / "data.db"
        count = _write_label_db(
            tmp_db,
            AMSTERDAM_PACK_LABELS,
            {
                "schema_version": "1",
                "region_id": "nl-amsterdam-metro",
                "name": "Amsterdam Metropolitan Detail Pack",
                "version": "2.0.0",
                "source": "SimplexDM Curated Gazetteer (ODbL / Public Domain)",
                "feature_count": str(len(AMSTERDAM_PACK_LABELS)),
            },
        )
        raw_bytes = tmp_db.read_bytes()
        sha256 = hashlib.sha256(raw_bytes).hexdigest()
        meta = {
            "id": "nl-amsterdam-metro",
            "name": "Amsterdam Metropolitan Detail Pack",
            "name_ar": "حزمة تفاصيل أمستردام الكبرى",
            "version": "2.0.0",
            "sha256": sha256,
            "sizeBytes": len(raw_bytes),
            "labelCount": count,
            "feature_count": count,
            "bbox": {
                "west": 4.72,
                "south": 52.28,
                "east": 5.05,
                "north": 52.44,
            },
            "zoomMin": 11,
            "zoomMax": 22,
            "languages": ["native", "en", "ar"],
            "createdAt": "2026-11-16T00:00:00Z",
        }
        with zipfile.ZipFile(str(rlp_path), "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
            zf.write(str(tmp_db), arcname="data.db")
        return meta


def main() -> int:
    base_count = _write_label_db(
        DEFAULT_BASE_DB,
        WORLD_LABELS,
        {
            "schema_version": "1",
            "name": "SimplexDM World Base Labels",
            "version": "2.0.0",
            "source": "Natural Earth / GeoNames curated multilingual gazetteer",
            "languages": "native,en,ar",
            "feature_count": str(len(WORLD_LABELS)),
            "created_at": "2026-11-16T00:00:00Z",
        },
    )
    rlp_manifest = build_sample_rlp(DEFAULT_SAMPLE_RLP)
    print(
        f"✓ Built {DEFAULT_BASE_DB.relative_to(ROOT)} ({base_count} multilingual labels, "
        f"{DEFAULT_BASE_DB.stat().st_size:,} bytes)"
    )
    print(
        f"✓ Built {DEFAULT_SAMPLE_RLP.relative_to(ROOT)} ({rlp_manifest['feature_count']} regional labels, "
        f"{DEFAULT_SAMPLE_RLP.stat().st_size:,} bytes, sha256={rlp_manifest['sha256'][:12]}…)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
