"""
Streamlit entry point for the US Obesity & Health Trends dashboard.
Reads the self-contained dashboard.html and embeds it as a full-page component.
"""

import streamlit as st
from pathlib import Path

st.set_page_config(page_title="US Obesity Trends", layout="wide",
                   initial_sidebar_state="collapsed")

html_path = Path(__file__).parent / "dashboard.html"
html_content = html_path.read_text(encoding="utf-8")

st.components.v1.html(html_content, height=980, scrolling=True)
