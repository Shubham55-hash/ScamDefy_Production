import asyncio
import os
import sys
from dotenv import load_dotenv

api_dir = os.path.dirname(os.path.abspath(__file__))
if api_dir not in sys.path:
    sys.path.append(api_dir)

load_dotenv()

async def test_immediate_alerts():
    from services.guardian_service import send_alert
    
    test_email = os.getenv("SMTP_USER", "shubhamshah048@gmail.com")
    print(f"--- Running Immediate Alert Test on {test_email} ---")
    
    # Attempt 1
    print("Sending alert #1...")
    res1 = await send_alert("Test 1", test_email, "Tester", "TEST", "Scam 1", 90)
    print(f"Result 1: {res1}")
    
    # Attempt 2 (Previously would have been rate limited)
    print("\nSending alert #2 (Immediate)...")
    res2 = await send_alert("Test 2", test_email, "Tester", "TEST", "Scam 2", 90)
    print(f"Result 2: {res2}")
    
    if res1.get("sent") and res2.get("sent"):
        print("\n✅ SUCCESS: Rate limit successfully removed. Both alerts sent.")
    else:
        print("\n❌ FAILURE: Rate limit might still be active.")

if __name__ == "__main__":
    asyncio.run(test_immediate_alerts())
