import openpyxl
import json
import os
import re

def clean_barcode(barcode):
    if barcode is None:
        return ""
    # Remove scientific notation or extra decimals
    s = str(barcode).strip()
    if 'e' in s.lower() or 'E' in s.lower():
        try:
            s = "{:.0f}".format(float(s))
        except:
            pass
    # Remove trailing .0
    if s.endswith('.0'):
        s = s[:-2]
    return s

def process_catalog(filename):
    print(f"Loading {filename}...")
    wb = openpyxl.load_workbook(filename, data_only=True)
    sheet = wb.active
    
    products = []
    unique_categories = {} # path -> {name, parent_path}
    
    rows = list(sheet.iter_rows(min_row=2, values_only=True))
    print(f"Processing {len(rows)} rows...")
    
    for row in rows:
        if not row[4]: # Skip if no description
            continue
            
        group = row[1] or "Unknown"
        subgroup = row[2] or "General"
        
        # Build category hierarchy
        path = f"{group} > {subgroup}"
        if group not in unique_categories:
            unique_categories[group] = {"name": group, "parent": None}
        if path not in unique_categories:
            unique_categories[path] = {"name": subgroup, "parent": group}
            
        # Select best barcode
        upcs = [clean_barcode(row[i]) for i in range(16, 21)]
        barcode = next((u for u in upcs if u), "")
        
        product = {
            "name": str(row[4]).strip(),
            "brand": str(row[29]).strip() if row[29] else None,
            "category_path": path,
            "quantity": str(row[7]).strip() if row[7] else None,
            "cost_per_bottle": float(row[9]) if row[9] else 0.0,
            "barcode": barcode,
            "country_of_origin": str(row[31]).strip() if row[31] else None,
            "source": "catalog_import"
        }
        products.append(product)
        
    # Construct category list for easier insertion
    cat_list = []
    # Sort by path length to ensure parents are handled first if needed, 
    # but the path logic handles it well.
    for path, info in unique_categories.items():
        cat_list.append({
            "path": path,
            "name": info["name"],
            "parent_name": info["parent"]
        })
        
    output = {
        "categories": cat_list,
        "products": products
    }
    
    with open('cleaned_catalog.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Exported {len(products)} products and {len(cat_list)} categories to cleaned_catalog.json")

if __name__ == "__main__":
    process_catalog('Wholesale_Spirits_Catalog_Full.xlsx')
