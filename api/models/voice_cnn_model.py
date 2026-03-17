import torch
import torch.nn as nn
import torch.nn.functional as F

class VoiceCNN(nn.Module):
    def __init__(self):
        super(VoiceCNN, self).__init__()
        # Input shape: (Batch Size, 1, 40, 128)
        self.conv1 = nn.Conv2d(1, 32, kernel_size=3, padding=1)
        self.pool = nn.MaxPool2d(2, 2)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        
        # After 3 pooling layers of 2x2:
        # 40 -> 20 -> 10 -> 5
        # 128 -> 64 -> 32 -> 16
        # Flattened size: 128 * 5 * 16 = 10240
        self.fc1 = nn.Linear(128 * 5 * 16, 256)
        self.dropout = nn.Dropout(0.5)
        self.fc2 = nn.Linear(256, 64)
        self.fc3 = nn.Linear(64, 2)
        
    def forward(self, x):
        x = self.pool(F.relu(self.conv1(x)))
        x = self.pool(F.relu(self.conv2(x)))
        x = self.pool(F.relu(self.conv3(x)))
        
        x = torch.flatten(x, 1) # Flatten all dimensions except batch
        
        x = F.relu(self.fc1(x))
        x = self.dropout(x)
        x = F.relu(self.fc2(x))
        x = self.fc3(x)
        
        # Return softmax probabilities
        return F.softmax(x, dim=1)
