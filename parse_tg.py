import re
import urllib.request
from bs4 import BeautifulSoup

req = urllib.request.Request('https://t.me/s/whale_alert_io', headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req).read().decode('utf-8')
soup = BeautifulSoup(html, 'html.parser')

alerts = []
for msg in soup.find_all('div', class_='tgme_widget_message_text'):
    text = msg.get_text()
    if '🚨' in text and 'transferred from' in text:
        # Example: "🚨 🚨 🚨  101,665,000 $USDT (101,543,713 USD) transferred from #Bitfinex to Tether TreasuryDetails"
        clean = re.sub(r'🚨\s*', '', text).replace('&#036;', '$').strip()
        link_elem = msg.find('a', href=re.compile('whale-alert.io/transaction'))
        link = link_elem['href'] if link_elem else None
        
        # Parse elements
        m = re.search(r'([0-9,.]+)\s*\$?([A-Za-z]+)\s*\(([0-9,.]+)\s*USD\)\s*transferred from\s*(.+?)\s*to\s*(.+?)(?:Details|$)', clean)
        if m:
            alerts.append({
                'amount': float(m.group(1).replace(',','')),
                'symbol': m.group(2),
                'usd': float(m.group(3).replace(',','')),
                'from': m.group(4).strip(),
                'to': m.group(5).strip(),
                'link': link
            })

print(f"Found {len(alerts)} alerts")
for a in alerts[:5]:
    print(a)
