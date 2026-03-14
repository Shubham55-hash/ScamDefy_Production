#!/bin/bash
set -e
echo "Starting ScamDefy Backend..."
pip install -r requirements.txt
python -m pytest tests/ -v
echo "All tests passed. Starting server..."
uvicorn main:app --reload --host 0.0.0.0 --port 8000
