/**
 * SimplexDM Arabic locale — Part 2 (registry, Control Center)
 * Source module consumed by `scripts/emit-locale.mjs`.
 */
export default {
  "registry": {
    "sceneModes": {
      "transparency": {
        "label": "الشفافية",
        "hint": "شفافية تراكبية على البلاطات"
      },
      "fog": {
        "label": "الضباب",
        "hint": "كثافة الضباب الجوي وسطوع الأرضية"
      },
      "white": {
        "label": "نموذج أبيض",
        "hint": "تظليل مسطح"
      },
      "slope": {
        "label": "تظليل الميل",
        "hint": "ألوان ميل التضاريس"
      },
      "height": {
        "label": "تلوين الارتفاع",
        "hint": "حسب الارتفاع"
      },
      "distance": {
        "label": "خريطة العمق",
        "hint": "تصور مسافة الكاميرا"
      },
      "direction": {
        "label": "الاتجاه / الجهة",
        "hint": "جهة السطح"
      },
      "snow": {
        "label": "الثلج",
        "hint": "تأثير ثلج"
      },
      "clouds": {
        "label": "الغيوم",
        "hint": "تأثير غيوم"
      },
      "ortho": {
        "label": "متعامد",
        "hint": "عامل عرض الكاميرا المتعامدة"
      },
      "remapColors": {
        "label": "ألوان موضوعية",
        "hint": "إعادة تعيين بمقسوم الارتفاع"
      }
    },
    "analysis": {
      "Measure": {
        "label": "قياس",
        "hint": "أدوات قياس Ion / الشريط (#measure)"
      },
      "LOS": {
        "label": "خط النظر",
        "hint": "تحليل LOS (#lineofsight)"
      },
      "Viewshed": {
        "label": "مجال الرؤية",
        "hint": "الرؤية / النطاق (#viewshed)"
      }
    },
    "mapGroups": {
      "nav": {
        "label": "التنقل والكاميرا"
      },
      "capture": {
        "label": "التقاط ومشاركة"
      },
      "scene": {
        "label": "أدوات المشهد"
      },
      "analysis": {
        "label": "شريط القياس"
      },
      "display": {
        "label": "العرض"
      }
    },
    "mapTools": {
      "layersIC": {
        "label": "قائمة الطبقات"
      },
      "view_home": {
        "label": "منظر البداية"
      },
      "history": {
        "label": "السجل (سابق / تالي)"
      },
      "navNorth": {
        "label": "تدوير نحو الشمال"
      },
      "topView": {
        "label": "منظر علوي"
      },
      "share": {
        "label": "مشاركة الموقع"
      },
      "printscreen": {
        "label": "لقطة شاشة"
      },
      "streetview": {
        "label": "عرض الشارع"
      },
      "flightmode": {
        "label": "وضع الطيران"
      },
      "clipplane": {
        "label": "قص بالمضلع"
      },
      "split": {
        "label": "شاشة مقسومة"
      },
      "elevationProfile": {
        "label": "ملف الارتفاع"
      },
      "special_effects": {
        "label": "أوضاع العرض"
      }
    },
    "chrome": {
      "showNavigationHelp": "مساعدة التنقل",
      "showDatabase": "قاعدة البيانات",
      "showDashboard": "لوحة التحكم",
      "showDirections": "الاتجاهات",
      "showHelp": "مساعدة"
    },
    "modules": {
      "searchManager": "بحث",
      "modelsMapManager": "خريطة النماذج",
      "shareLocationManager": "مشاركة الموقع",
      "layersMenuManager": "قائمة الطبقات",
      "shadeAnalysisManager": "تحليل الظل",
      "coordinateResearchManager": "بحث الإحداثيات",
      "splitScreenManager": "شاشة مقسومة",
      "streetViewManager": "عرض الشارع",
      "simVisualToolsBridge": "SIM مرئي / مستشعرات",
      "simIntegrationManager": "تكامل SIM",
      "projectManager": "مشروع GIS",
      "geoprocessingUI": "معالجة جغرافية",
      "offlineStatusUI": "حالة عدم الاتصال",
      "tileInspectorUI": "مفتش البلاطات",
      "bookmarkManager": "إشارات مرجعية",
      "screenshotManager": "لقطة شاشة",
      "enhancedMeasurementManager": "قياس",
      "lineOfSightManager": "خط النظر",
      "visibleHiddenAreasManager": "نطاق الرؤية",
      "cutByPolygonManager": "قص بالمضلع",
      "displayModesManager": "أوضاع العرض",
      "supermanFlightModeManager": "وضع الطيران",
      "obliqueViewsManager": "مناظر مائلة",
      "modelAndLayerUploadManager": "رفع نموذج وطبقة",
      "coordinateManager": "الإحداثيات",
      "featureInteractionManager": "تفاعل العناصر",
      "labelManager": "تسميات الخريطة (دون اتصال)"
    },
    "modGroups": {
      "discovery": {
        "label": "بحث، طبقات وإحداثيات"
      },
      "viz": {
        "label": "تصور وأوضاع الكاميرا"
      },
      "analysis": {
        "label": "تحليل وتحرير"
      },
      "gis": {
        "label": "GIS وبيانات"
      },
      "sim": {
        "label": "SIM"
      },
      "utilities": {
        "label": "أدوات مساعدة"
      }
    }
  },
  "cc": {
    "perf": {
      "lead": "الإنتاجية وميزانيات الخيط الرئيسي. القيم مُحدّدة؛ تُربط بـ <code>performance</code> في إعداد التطبيق و<code>window.__simplexPerformance</code>.",
      "frameBudget": "ميزانية إطار حلقة العرض (مللي ثانية)",
      "idleTimeout": "مهلة استدعاء الخمول (مللي ثانية)",
      "yield": "إرجاء تهيئة مؤجّل (مللي ثانية)",
      "maxReq": "الحد الأقصى للطلبات لكل خادم",
      "resScale": "الحد الأقصى لمقياس دقة العارض",
      "default": "افتراضي:",
      "browserRes": "استخدام دقة المتصفح الموصى بها (أنعم على HiDPI)",
      "subhead3d": "3D Tiles / تفاصيل الشبكة",
      "tileHint": "يُربط بـ <code>layerRendering</code> في إعداد التطبيق (يُحفظ مع مركز التحكم). <strong>أقل</strong> قيمة SSE قصوى = هندسة أوضح وشبكات أوضح؛ راقب FPS. <strong>أعلى</strong> (مثل 12–16) = أسرع على وحدات معالجة أضعف. النطاق النموذجي 2–8.",
      "tileSse": "الحد الأقصى لخطأ مساحة الشاشة للبلاطات (سقف)",
      "dynamicSse": "خطأ مساحة شاشة ديناميكي على البلاطات (عند الدعم)",
      "lrEnable": "تفعيل ضبط جودة الطبقة / البلاطات"
    },
    "features": {
      "heroLead": "اضبط كتالوج التطبيق، الأعلام، افتراضات الطبقات، سمة الواجهة، وأي أزرار شريط علوي مرئية. يُطبّق الحفظ عبر <code>AppSettingsFramework</code> ويُحدّث شريط أدوات الخريطة.",
      "toolCatalogSummary": "كتالوج الأدوات <span class=\"cc-tag\">tools.items</span>",
      "toolCatalogHint": "يتحكم بالإدخالات المتاحة للشريط المتداخل / حافلة أحداث التطبيق.",
      "masterCatalog": "رئيسي: تفعيل كتالوج الأدوات",
      "tableId": "المعرف",
      "tableLabel": "التسمية",
      "tableOn": "تشغيل",
      "featureModules": "وحدات الميزات",
      "measurement": "القياس",
      "accuracyM": "الدقة (م)",
      "requireZoom": "يتطلب تكبيرًا",
      "navigation": "التنقل",
      "cameraHistorySize": "حجم سجل الكاميرا",
      "autoSaveHistory": "حفظ تلقائي لسجل الكاميرا",
      "layersMenuFeature": "ميزة قائمة الطبقات",
      "collaborationSummary": "التعاون <span class=\"cc-tag\">features.collaboration</span>",
      "collabEnable": "تفعيل خطافات التعاون (إشارات مرجعية / تعليقات عند تحميل الوحدة)",
      "backendUrl": "عنوان أساسي للخادم الخلفي",
      "collabHint": "فحص الصحة يستخدم <code>GET {baseUrl}/health</code>. سكربت التعاون اختياري في الحزمة الرئيسية.",
      "runtimeModulesSummary": "تهيئة وحدات التشغيل <span class=\"cc-tag\">modules</span>",
      "runtimeModulesHint": "عند الإيقاف، يُتخطى <code>init()</code> لذلك المدير في التحميل التالي. ربط شريط أدوات الخريطة يعمل دائمًا. يُزامن الحفظ أيضًا صفوف <strong>كتالوج الأدوات</strong> المطابقة. أعد التحميل بعد تغيير الوحدات.",
      "layerDefaultsSummary": "افتراضات الطبقات <span class=\"cc-tag\">features.layers</span>",
      "layerDefaultsHint": "معرفات طبقات مفصولة بفواصل (مثل <code>background, 3d, streets</code>). تُستخدم عند تهيئة قائمة الطبقات.",
      "defaultVisible": "افتراضي مرئي",
      "defaultHidden": "افتراضي مخفي",
      "appearanceSummary": "المظهر وتخطيط الواجهة",
      "theme": "السمة",
      "themeDark": "داكن",
      "themeLight": "فاتح",
      "languageCode": "رمز اللغة",
      "langPlaceholder": "en أو ar",
      "langTitle": "en = إنجليزي، ar = عربي (RTL)",
      "langHint": "<code>en</code> English · <code>ar</code> العربية (التخطيط يتحول إلى RTL)",
      "placeholderApi": "https://api.example.com",
      "placeholderLayersVis": "background, 3d",
      "placeholderLayersHid": "streets, parcels, …",
      "sbLeftCollapsed": "الشريط الجانبي الأيسر يبدأ مطويًا",
      "sbRightCollapsed": "الشريط الجانبي الأيمن يبدأ مطويًا",
      "toolsStripCollapsed": "تصغير شريط أدوات الخريطة السفلي عند التحميل",
      "topNavSummary": "رؤية الشريط العلوي <span class=\"cc-tag\">ui.chrome</span>",
      "qualityLow": "منخفض",
      "qualityMedium": "متوسط",
      "qualityHigh": "عالٍ",
      "qualityUltra": "فائق",
      "langOptionEn": "الإنجليزية",
      "langOptionAr": "العربية"
    },
    "scene": {
      "heroLead": "يتحكم برؤية ووضع «PRO» للشريط الفرعي، أزرار التحليل، وشريط أدوات الخريطة. يطابق <code>smart3dToolbarWireup.applyConfigVisibility</code>.",
      "analysisSummary": "أدوات التحليل <span class=\"cc-tag\">Measure · LOS · Viewshed</span>",
      "sceneModesSummary": "أوضاع المشهد <span class=\"cc-tag\">toolbarSE</span>",
      "mapStripSummary": "شريط أدوات الخريطة <span class=\"cc-tag\">#toolbar · .tools</span>",
      "jsonPreview": "معاينة JSON",
      "show": "إظهار",
      "active": "نشط",
      "on": "تشغيل",
      "alpha": "α",
      "density": "الكثافة",
      "minBrightness": "أدنى سطوع",
      "heightDiv": "ارتفاع÷",
      "widthFactor": "عامل العرض",
      "gridSamples": "عينات الشبكة",
      "imageryBrightness": "سطوع الصور الفضائية",
      "imageryContrast": "تباين الصور الفضائية",
      "sceneTuningSummary": "ضبط المشهد والصور",
      "thresholdDeg1": "عتبة الانحدار الخفيف (°)",
      "thresholdDeg2": "عتبة الانحدار المتوسط (°)",
      "thresholdDeg3": "عتبة الانحدار الشديد (°)"
    },
    "project": {
      "notLoaded": "فهرس المشروع غير محمّل. تأكد من تضمين <code>projectIntegrationIndex.js</code> قبل مركز التحكم.",
      "heroCountLine": "<strong>{count}</strong> سكربت طرف أول تحت <code>public/js</code> (مستبعد vendor). ",
      "heroLead": "كل صف يوضح كيف ترتبط الوحدة بمركز التحكم، <code>jsonConfigManager</code>، <code>window.t</code>، أو تخزين المتصفح.",
      "storageKeysSummary": "مفاتيح التخزين المسجلة <span class=\"cc-tag\">AppSettingsFramework</span>",
      "thKey": "المفتاح",
      "thCategory": "الفئة",
      "thRole": "الدور",
      "htmlEntrySummary": "نقاط دخول HTML وCSS والخادم والإعداد",
      "thPath": "المسار",
      "thType": "النوع",
      "thSettingsLink": "رابط الإعدادات",
      "allJsSummary": "كل وحدات JavaScript الطرف الأول",
      "thArea": "المنطقة",
      "thIntegration": "التكامل"
    },
    "local": {
      "mapLabelsSummary": "تسميات الخريطة دون اتصال <span class=\"cc-tag\">SQLite · .rlp</span>",
      "mapLabelsEnable": "إظهار تسميات الخريطة على الكرة",
      "mapLabelsHint": "اضبط الأنواع واللغة وحزم المناطق في الشريط الجانبي الأيسر تحت «تسميات الخريطة». تُستعلم البيانات في تطبيق سطح المكتب عبر Electron.",
      "mapLabelsOpenPanel": "فتح لوحة التسميات في الشريط الجانبي",
      "dashPrefs": "لوحة التحكم / تفضيلات التطبيق (<code>appSettings</code>)",
      "dataDir": "مجلد البيانات",
      "autoLoad": "تحميل tilesets تلقائيًا عند البدء",
      "notify": "إظهار الإشعارات",
      "autoPath": "حفظ تلقائي للمسارات",
      "defaultQuality": "الجودة الافتراضية",
      "memMb": "حد الذاكرة (ميجابايت)",
      "platformHdr": "عناصر تحكم المنصة",
      "site": "الموقع متاح",
      "land": "استخدام الأراضي",
      "sunLocal": "موضع الشمس (محلي)",
      "simHdr": "مستشعر SIM (Ion SDK)",
      "radius": "نصف القطر",
      "xHalf": "نصف زاوية X °",
      "yHalf": "نصف زاوية Y °",
      "lon": "خط الطول",
      "lat": "خط العرض",
      "height": "الارتفاع"
    },
    "save": {
      "allSaved": "تم حفظ كل الإعدادات (تشغيل)",
      "resetRuntimeConfirm": "مسح تجاوزات تشغيل مركز التحكم؟ ملفات JSON للشريط/التطبيق دون تغيير. يُنصح بإعادة التحميل.",
      "resetRuntimeInfo": "تم مسح التجاوزات. أعد تحميل الصفحة لتطبيق الافتراضات من القرص.",
      "resetAllConfirm": "مسح التجاوزات وإعادة تعيين appSettings وعناصر المنصة ومفاتيح مستشعر SIM المخزنة؟",
      "resetAllInfo": "تم مسح مفاتيح التفضيلات المحلية. أعد تحميل الصفحة.",
      "importFullOk": "تم استيراد اللقطة الكاملة. أعد التحميل إذا بدا شيء قديمًا.",
      "importOk": "تم الاستيراد. بعض التغييرات تُطبّق بالكامل بعد إعادة التحميل.",
      "invalidJson": "JSON غير صالح: "
    }
  }
};
