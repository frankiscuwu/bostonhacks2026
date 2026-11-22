
"""
Django settings for the BostonHacks 2026 backend.

Uses environment variables to keep secrets and database
credentials out of GitHub.
"""

import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured


# Base directory: backend/
BASE_DIR = Path(__file__).resolve().parent.parent

# Load local environment variables from backend/.env
load_dotenv(BASE_DIR / ".env")


# Security settings
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")

if not SECRET_KEY:
    raise ImproperlyConfigured(
        "Missing DJANGO_SECRET_KEY in environment variables."
    )

DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() == "true"

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv(
        "DJANGO_ALLOWED_HOSTS",
        "localhost,127.0.0.1"
    ).split(",")
    if host.strip()
]


# Installed applications
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Third-party apps
    "rest_framework",
    "corsheaders",

    # BostonHacks apps
    "restaurants",
    "rooms",
]


# Middleware
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


# URL configuration
ROOT_URLCONF = "config.urls"


# Templates
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# Application entry points
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"


# Database
# Uses SQLite locally, Supabase PostgreSQL when
# DATABASE_URL is configured.
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        # Reuse connections between requests: opening one to the remote
        # database costs ~0.2s. Health checks drop connections that went stale.
        conn_max_age=60,
        conn_health_checks=True,
    )
}

# This cache contains public MBTA topology/responses only, never directions or
# participant coordinates. A separate alias lets the warm command and web
# workers share topology on one host without changing room/API throttle caching.
CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "transit": {
        "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
        "LOCATION": os.getenv("MBTA_CACHE_LOCATION", "/tmp/reelhungry-mbta-cache"),
        "TIMEOUT": 3600,
        "OPTIONS": {"MAX_ENTRIES": 1000},
    },
    # Google Places photo lookups (public place data), kept across restarts to save quota.
    "photos": {
        "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
        "LOCATION": os.getenv("PHOTO_CACHE_LOCATION", "/tmp/reelhungry-photo-cache"),
        "TIMEOUT": 7 * 24 * 3600,
        "OPTIONS": {"MAX_ENTRIES": 20000},
    },
}


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Language and timezone
LANGUAGE_CODE = "en-us"
TIME_ZONE = "America/New_York"
USE_I18N = True
USE_TZ = True


# Static files
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Allow React + Vite frontend to communicate with Django. Set
# CORS_ALLOWED_ORIGINS (comma-separated, exact scheme + host, no trailing slash)
# to override; the default covers local dev and the production Vercel site.
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,https://reelhungry.boston,https://www.reelhungry.boston,https://bostonhacks2026.vercel.app,https://bostonhacks2026-production.up.railway.app"
    ).split(",")
    if origin.strip()
]

# The room endpoints authenticate participants with this custom header, so the
# browser's CORS preflight must be allowed to send it.
from corsheaders.defaults import default_headers  # noqa: E402

CORS_ALLOW_HEADERS = (*default_headers, "x-participant-token")
