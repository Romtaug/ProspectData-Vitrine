"""
ProspectData - vitrine servie par Streamlit
===============================================================================
Le site est entierement contenu dans index.html : le CSS, le JavaScript, la FAQ
du chatbot et les images sont tous integres dans ce seul fichier. Ce script n'a
donc plus qu'a le lire et l'afficher en plein ecran.

Lancer en local :
    streamlit run streamlit_app.py

A savoir : Streamlit reste un mauvais hebergeur pour une page commerciale. Voir
la section correspondante du README. GitHub Pages et Netlify font mieux, et sont
gratuits eux aussi.
"""

from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).parent
PAGE = ROOT / "index.html"
ICON = ROOT / "favicon.png"

st.set_page_config(
    page_title="ProspectData - Un CRM de prospection qui se met a jour tout seul",
    page_icon=str(ICON) if ICON.exists() else "🎯",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# On efface l'habillage Streamlit et on laisse la page occuper tout l'ecran,
# pour que le visiteur voie un site et non une application.
st.markdown(
    """
    <style>
      #MainMenu, header[data-testid="stHeader"], footer, [data-testid="stToolbar"],
      [data-testid="stDecoration"], [data-testid="stStatusWidget"] { display: none !important; }
      .block-container { padding: 0 !important; max-width: 100% !important; }
      [data-testid="stAppViewContainer"] > .main { padding: 0 !important; }
      [data-testid="stVerticalBlock"] { gap: 0 !important; }
      iframe[title="streamlit.components.v1.html"] {
        height: 100vh !important; width: 100% !important; border: none !important; display: block;
      }
      html, body { overflow: hidden !important; margin: 0 !important; padding: 0 !important; }
    </style>
    """,
    unsafe_allow_html=True,
)

if PAGE.exists():
    components.html(PAGE.read_text(encoding="utf-8"), height=900, scrolling=True)
else:
    st.error("index.html est introuvable a la racine du depot.")
