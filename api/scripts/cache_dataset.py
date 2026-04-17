
import os
import sys
import time
from datasets import load_dataset, Dataset, Audio
from tqdm import tqdm

# Configuration
DATASET_NAME = "Bisher/ASVspoof_2019_LA"
BASE_DIR = r"C:\ScamDefy\ScamDefy-Final\api"
CACHE_DIR = os.path.join(BASE_DIR, "data", "asvspoof_cache")

def cache_dataset_streaming():
    print(f"--- ScamDefy Transparent Cache (v2.4.1 Emoji-Free) ---")
    print(f"Target: {CACHE_DIR}")
    
    if not os.path.exists(os.path.dirname(CACHE_DIR)):
        os.makedirs(os.path.dirname(CACHE_DIR), exist_ok=True)

    if os.path.exists(CACHE_DIR) and len(os.listdir(CACHE_DIR)) > 0:
        print("INFO: Cache already exists. Skipping.")
        return

    try:
        print("Connecting to HuggingFace...")
        # Load in streaming mode
        # Retries are handled by the datasets library automatically
        ds_stream = load_dataset(DATASET_NAME, split="train", streaming=True)
        ds_stream = ds_stream.cast_column("audio", Audio(decode=False))
        
        samples = []
        limit = 20000
        
        print(f"Streaming first {limit} samples. Progress will show below:")
        pbar = tqdm(total=limit, desc="Download Progress")
        
        it = iter(ds_stream)
        count = 0
        while count < limit:
            try:
                sample = next(it)
                samples.append(sample)
                count += 1
                pbar.update(1)
            except StopIteration:
                break
            except Exception as e:
                print(f"Network hiccup: {e}. Retrying sample...")
                time.sleep(2)
                continue
                
        pbar.close()
        
        print("\nFinalizing local storage...")
        ds_final = Dataset.from_list(samples)
        ds_final.save_to_disk(CACHE_DIR)
        
        print("\nSUCCESS: Dataset cached locally.")
        
    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    cache_dataset_streaming()
