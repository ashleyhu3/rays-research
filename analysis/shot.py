import sys
from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    for theme,fn in [("light","shot_light.png"),("dark","shot_dark.png")]:
        pg=b.new_page(viewport={"width":1000,"height":1400}, color_scheme=theme)
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in("error","warning") else None)
        pg.on("pageerror", lambda e: errs.append(f"PAGEERROR: {e}"))
        pg.goto("file://"+__import__("os").path.abspath("report.html"))
        pg.wait_for_timeout(700)
        pg.screenshot(path=fn, full_page=True)
        pg.close()
    b.close()
print("CONSOLE ISSUES:", errs if errs else "none")
