import os

RUST_BACKEND_URL = os.getenv("RUST_BACKEND_URL", "http://localhost:8080")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "dev-internal-key")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://amis_ai:amis_ai_dev@localhost:5432/amis_ai")
