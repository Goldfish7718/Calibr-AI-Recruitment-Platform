"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Building2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useEmployerProfileUpdate, useCompanyLogoUpload } from "../hooks";

interface CompanyLogoProps {
  profileData: any;
  setProfileData: (data: any) => void;
}

export default function CompanyLogo({ profileData, setProfileData }: CompanyLogoProps) {
  const [isLogoUploadDialogOpen, setIsLogoUploadDialogOpen] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | undefined>(undefined);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoLoadError, setLogoLoadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { updateProfile } = useEmployerProfileUpdate();
  const { uploadLogo, isUploading } = useCompanyLogoUpload();

  const validateImageFile = (file: File): { valid: boolean; error?: string } => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(file.type)) {
      return { valid: false, error: 'Please select a valid image file (JPEG, PNG, GIF, or WebP)' };
    }

    if (file.size > maxSize) {
      return { valid: false, error: 'Image size must be less than 5MB' };
    }

    return { valid: true };
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const validation = validateImageFile(file);
      if (!validation.valid) {
        toast.error(validation.error);
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      toast.success("Logo selected successfully");
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const validation = validateImageFile(file);
      if (!validation.valid) {
        toast.error(validation.error);
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      toast.success("Logo dropped successfully");
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleLogoUpload = async () => {
    if (!logoFile) {
      toast.error("Please select a logo to upload");
      return;
    }

    const formData = new FormData();
    formData.append('file', logoFile);

    const uploadResult = await uploadLogo(formData);
    
    if (uploadResult.success && uploadResult.fileUrl) {
      const updatedData = {
        ...profileData,
        companyLogo: uploadResult.fileUrl,
      };

      const res = await updateProfile(updatedData);

      if (res.success) {
        setProfileData(updatedData);
        setLogoLoadError(false);
      }
    }
    
    // Always close dialog after upload attempt (success or error)
    setIsLogoUploadDialogOpen(false);
    setLogoPreview(undefined);
    setLogoFile(null);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="relative">
      <Avatar className="w-32 h-32 rounded-lg">
        {profileData.companyLogo && !logoLoadError ? (
          <AvatarImage 
            src={profileData.companyLogo} 
            alt={`${profileData.companyName} logo`}
            className="object-contain p-2 bg-white"
            onLoad={() => setLogoLoadError(false)}
            onError={() => setLogoLoadError(true)}
          />
        ) : null}
        <AvatarFallback className="bg-purple-600 text-white text-4xl rounded-lg">
          <Building2 className="w-16 h-16" />
        </AvatarFallback>
      </Avatar>

      <Dialog open={isLogoUploadDialogOpen} onOpenChange={setIsLogoUploadDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute bottom-0 right-0 bg-purple-600 hover:bg-purple-700 text-white rounded-full w-8 h-8"
          >
            <Building2 className="w-4 h-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-gray-900 border-gray-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Update Company Logo</DialogTitle>
            <DialogDescription className="text-gray-300">
              Upload your company logo. Supported formats: JPEG, PNG, GIF, WebP (Max 5MB)
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center hover:border-gray-500 transition-colors cursor-pointer"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={triggerFileInput}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              
              {logoPreview ? (
                <div className="space-y-3">
                  <Image
                    src={logoPreview}
                    alt="Preview"
                    width={128}
                    height={128}
                    className="mx-auto h-32 w-32 object-contain rounded-lg bg-white p-2"
                  />
                  <p className="text-sm text-gray-300">Click to change logo</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <UploadCloud className="mx-auto h-12 w-12 text-gray-400" />
                  <div>
                    <p className="text-gray-300">
                      <span className="font-medium">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-gray-500">PNG, JPG, GIF up to 5MB</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => {
                  setIsLogoUploadDialogOpen(false);
                  setLogoPreview(undefined);
                  setLogoFile(null);
                }}
                disabled={isUploading}
                className="border-red-600 text-red-400 hover:bg-red-900/20 hover:text-red-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleLogoUpload}
                disabled={!logoFile || isUploading}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isUploading ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
