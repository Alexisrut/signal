"""Собирает все три руководства: python3 build_all.py"""
import runpy, os
HERE = os.path.dirname(os.path.abspath(__file__))
for name in ['content_superadmin', 'content_admin', 'content_contractor']:
    runpy.run_path(os.path.join(HERE, name + '.py'), run_name='__main__')
