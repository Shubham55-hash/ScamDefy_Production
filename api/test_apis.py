import asyncio
import os
import sys
from dotenv import load_dotenv

# Ensure api/ is on sys.path
api_dir = os.path.dirname(os.path.abspath(__file__))
if api_dir not in sys.path:
    sys.path.append(api_dir)

load_dotenv()

async def test_all_apis():
    from services import gsb_service, urlhaus_service
    from utils import url_expander
    
    print("--- Testing URL Expander ---")
    res = await url_expander.health_check()
    print(f"URL Expander: {res}")
    
    print("\n--- Testing GSB API ---")
    res = await gsb_service.health_check()
    print(f"GSB: {res}")
    
    print("\n--- Testing URLhaus API ---")
    res = await urlhaus_service.health_check()
    print(f"URLhaus: {res}")

if __name__ == "__main__":
    asyncio.run(test_all_apis())
