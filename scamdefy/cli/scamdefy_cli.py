#!/usr/bin/env python3
"""
ScamDefy CLI — Check any URL for phishing/malware risk
Usage: python scamdefy_cli.py https://example.com
"""

import sys
import os
import argparse
import asyncio
from colorama import init, Fore, Style
from dotenv import load_dotenv

# Add backend directory to sys.path to import services
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

load_dotenv(os.path.join(backend_path, '.env'))

from services.gsb_service import check_url as check_gsb, health_check as hc_gsb
from services.urlhaus_service import check_url as check_uh, health_check as hc_uh
from services.domain_service import analyze as analyze_domain
from services.risk_service import score as calculate_score

init(autoreset=True)

async def scan_url(url: str):
    print(f"{Fore.CYAN}Scanning URL: {url}...")
    
    # Run API checks concurrently
    results = await asyncio.gather(
        check_gsb(url),
        check_uh(url)
    )
    gsb_res, uh_res = results
    
    # Run local domain logic
    domain_res = analyze_domain(url)
    
    # Calculate score
    risk = calculate_score(gsb_res, uh_res, domain_res, url)
    
    verdict = risk['verdict']
    score = risk['score']
    
    # Color formatting
    if verdict == "SAFE":
        v_color = Fore.GREEN
        v_icon = "✓ SAFE"
    elif verdict == "CAUTION":
        v_color = Fore.YELLOW
        v_icon = "⚠ CAUTION"
    elif verdict == "DANGER":
        v_color = Fore.RED
        v_icon = "☢ DANGER"
    else:
        v_color = Fore.LIGHTRED_EX
        v_icon = "⛔ BLOCKED"

    # Display Report
    print(f"\n  ╔{u'═'*32}╗")
    print(f"  ║ {Fore.MAGENTA}  ScamDefy URL Risk Report  {Style.RESET_ALL}   ║")
    print(f"  ╠{u'═'*32}╣")
    print(f"  ║ URL:     {url[:20]}{'...' if len(url)>20 else ' '*(20-len(url))} ║")
    print(f"  ║ Score:   {score:<4}/100             ║")
    print(f"  ║ Verdict: {v_color}{v_icon:<14}{Style.RESET_ALL} ║")
    print(f"  ╠{u'═'*32}╣")
    
    gsb_text = "⚠ THREAT" if gsb_res.get('is_threat') else "✓ Clean "
    uh_text = "⚠ MALWARE" if uh_res.get('is_phishing') else "✓ Clean "
    dom_text = "⚠ Typo  " if domain_res.get('is_suspicious') else "✓ Clean "
    
    print(f"  ║ Google Safe Browsing: {Fore.RED if 'THREAT' in gsb_text else Fore.GREEN}{gsb_text}{Style.RESET_ALL} ║")
    print(f"  ║ URLHaus:              {Fore.RED if 'MALWARE' in uh_text else Fore.GREEN}{uh_text}{Style.RESET_ALL} ║")
    print(f"  ║ Domain Analysis:      {Fore.YELLOW if 'Typo' in dom_text else Fore.GREEN}{dom_text}{Style.RESET_ALL} ║")
    print(f"  ╚{u'═'*32}╝\n")

    if score > 30:
        print(f"{Fore.YELLOW}Flags Detected:{Style.RESET_ALL}")
        for flag in domain_res.get('flags', []):
            print(f"  - {flag['type']}: {flag['detail']}")
            
    if risk['should_block']:
        sys.exit(1)
    else:
        sys.exit(0)

async def run_health_check():
    print(f"{Fore.CYAN}Running ScamDefy CLI Health Check...{Style.RESET_ALL}")
    
    gsb_health, uh_health = await asyncio.gather(
        hc_gsb(),
        hc_uh()
    )

    print(f"Google Safe Browsing API: {'✅ OK' if gsb_health['status'] == 'ok' else '❌ FAIL - ' + gsb_health['reason']}")
    print(f"URLHaus API:              {'✅ OK' if uh_health['status'] == 'ok' else '❌ FAIL - ' + uh_health['reason']}")
    
    # Just a local logic check
    test_dom = analyze_domain("https://google.com")
    dom_status = "ok" if not test_dom['is_suspicious'] else "fail"
    print(f"Domain Analyzer:          {'✅ OK' if dom_status == 'ok' else '❌ FAIL'}")

def main():
    # Force UTF-8 encoding for standard output to handle Unicode characters on Windows
    import sys
    import io
    if sys.stdout and sys.stdout.encoding != 'utf-8':
        try:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        except (AttributeError, io.UnsupportedOperation):
            pass

    parser = argparse.ArgumentParser(description="ScamDefy CLI URL Risk Scanner")
    parser.add_argument("url", nargs="?", help="The URL to scan (e.g., https://example.com)")
    parser.add_argument("--health", action="store_true", help="Run API health checks")
    
    args = parser.parse_args()
    
    if args.health:
        asyncio.run(run_health_check())
        return
        
    if not args.url:
        parser.print_help()
        sys.exit(1)
        
    asyncio.run(scan_url(args.url))

if __name__ == "__main__":
    main()
