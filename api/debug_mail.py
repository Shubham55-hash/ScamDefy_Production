import asyncio
import os
import sys
from dotenv import load_dotenv

# Add the current directory to sys.path so we can import services
sys.path.append(os.getcwd())

from services.guardian_service import send_alert

async def test_specific_email():
    load_dotenv()
    test_email = "dhruvsoni172006@gmail.com"
    print(f"--- Sending Debug Alert to {test_email} ---")
    
    result = await send_alert(
        guardian_name="Dhruv (Test)",
        guardian_email=test_email,
        user_name="ScamDefy Debugger",
        alert_type="URL_SCAN",
        scam_type="Manual Debug Test",
        risk_score=100,
        is_escalation=False
    )
    
    print(f"Result: {result}")

if __name__ == "__main__":
    asyncio.run(test_specific_email())
