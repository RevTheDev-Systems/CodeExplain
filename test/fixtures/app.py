import os

def add(a, b):
    return a + b

def delete_all_users():
    db.execute("DELETE FROM users")

x = 5
os.unlink("/tmp/important.txt")
