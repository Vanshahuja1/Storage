"use server";

// Import necessary libraries and modules
import { createAdminClient, createSessionClient } from "@/lib/appwrite"; // Admin and session clients for Appwrite
import { InputFile } from "node-appwrite/file"; // For handling file uploads
import { appwriteConfig } from "@/lib/appwrite/config"; // Appwrite configurations
import { ID, Models, Query } from "node-appwrite"; // Appwrite SDK utilities
import { constructFileUrl, getFileType, parseStringify } from "@/lib/utils"; // Utility functions
import { revalidatePath } from "next/cache"; // Revalidate paths for SSR
import { getCurrentUser } from "@/lib/actions/user.actions"; // User actions

// Function to handle and log errors
const handleError = (error: unknown, message: string) => {
  console.error(message, error);
  throw new Error(message);
};

// ======================== UPLOAD FILE =========================
export const uploadFile = async ({ file, ownerId, accountId, path }: UploadFileProps) => {
  const { storage, databases } = await createAdminClient();

  try {
    // Convert the uploaded file into an Appwrite-compatible format
    const inputFile = InputFile.fromBuffer(file, file.name);

    // Upload the file to Appwrite storage
    const bucketFile = await storage.createFile(
      appwriteConfig.bucketId,
      ID.unique(),
      inputFile
    );

    // Prepare file metadata to save in the database
    const fileDocument = {
      type: getFileType(bucketFile.name).type, // File type (e.g., image, video)
      name: bucketFile.name, // File name
      url: constructFileUrl(bucketFile.$id), // File URL
      extension: getFileType(bucketFile.name).extension, // File extension
      size: bucketFile.sizeOriginal, // File size
      owner: ownerId, // File owner ID
      accountId, // Associated account ID
      users: [], // Users with access
      bucketFileId: bucketFile.$id, // ID of the file in the bucket
    };

    // Create a document in the database for the file
    const newFile = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      ID.unique(),
      fileDocument
    ).catch(async (error) => {
      // If the document creation fails, delete the uploaded file
      await storage.deleteFile(appwriteConfig.bucketId, bucketFile.$id);
      handleError(error, "Failed to create file document");
    });

    // Revalidate the path to reflect changes on the client
    revalidatePath(path);
    return parseStringify(newFile);
  } catch (error) {
    handleError(error, "Failed to upload file");
  }
};

// ======================== CREATE QUERIES =========================
const createQueries = (
  currentUser: Models.Document,
  types: string[],
  searchText: string,
  sort: string,
  limit?: number
) => {
  const queries = [
    Query.or([
      Query.equal("owner", [currentUser.$id]), // Files owned by the user
      Query.contains("users", [currentUser.email]), // Files shared with the user
    ]),
  ];

  // Add filters for file types, search text, and limits
  if (types.length > 0) queries.push(Query.equal("type", types));
  if (searchText) queries.push(Query.contains("name", searchText));
  if (limit) queries.push(Query.limit(limit));

  // Sorting options
  if (sort) {
    const [sortBy, orderBy] = sort.split("-");
    queries.push(
      orderBy === "asc" ? Query.orderAsc(sortBy) : Query.orderDesc(sortBy)
    );
  }

  return queries;
};

// ======================== GET FILES =========================
export const getFiles = async ({
  types = [],
  searchText = "",
  sort = "$createdAt-desc",
  limit,
}: GetFilesProps) => {
  const { databases } = await createAdminClient();

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("User not found");

    // Generate queries based on filters
    const queries = createQueries(currentUser, types, searchText, sort, limit);

    // Fetch files from the database
    const files = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      queries
    );

    return parseStringify(files);
  } catch (error) {
    handleError(error, "Failed to get files");
  }
};

// ======================== RENAME FILE =========================
export const renameFile = async ({ fileId, name, extension, path }: RenameFileProps) => {
  const { databases } = await createAdminClient();

  try {
    const newName = `${name}.${extension}`;

    // Update the file name in the database
    const updatedFile = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId,
      {
        name: newName,
      }
    );

    // Revalidate the path to reflect the change
    revalidatePath(path);
    return parseStringify(updatedFile);
  } catch (error) {
    handleError(error, "Failed to rename file");
  }
};

// ======================== UPDATE FILE USERS =========================
export const updateFileUsers = async ({ fileId, emails, path }: UpdateFileUsersProps) => {
  const { databases } = await createAdminClient();

  try {
    // Update the users who can access the file
    const updatedFile = await databases.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId,
      {
        users: emails,
      }
    );

    revalidatePath(path);
    return parseStringify(updatedFile);
  } catch (error) {
    handleError(error, "Failed to update file users");
  }
};

// ======================== DELETE FILE =========================
export const deleteFile = async ({ fileId, bucketFileId, path }: DeleteFileProps) => {
  const { databases, storage } = await createAdminClient();

  try {
    // Delete the file document from the database
    const deletedFile = await databases.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      fileId
    );

    // Delete the file from storage if the database deletion is successful
    if (deletedFile) {
      await storage.deleteFile(appwriteConfig.bucketId, bucketFileId);
    }

    revalidatePath(path);
    return parseStringify({ status: "success" });
  } catch (error) {
    handleError(error, "Failed to delete file");
  }
};

// ======================== TOTAL SPACE USED =========================
export async function getTotalSpaceUsed() {
  try {
    const { databases } = await createSessionClient();
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("User is not authenticated.");

    // Fetch all files owned by the current user
    const files = await databases.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.filesCollectionId,
      [Query.equal("owner", [currentUser.$id])]
    );

    // Initialize space usage structure
    const totalSpace = {
      image: { size: 0, latestDate: "" },
      document: { size: 0, latestDate: "" },
      video: { size: 0, latestDate: "" },
      audio: { size: 0, latestDate: "" },
      other: { size: 0, latestDate: "" },
      used: 0,
      all: 2 * 1024 * 1024 * 1024, // 2GB total storage
    };

    // Calculate space usage for each file type
    files.documents.forEach((file) => {
      const fileType = file.type as FileType;
      totalSpace[fileType].size += file.size;
      totalSpace.used += file.size;

      if (
        !totalSpace[fileType].latestDate ||
        new Date(file.$updatedAt) > new Date(totalSpace[fileType].latestDate)
      ) {
        totalSpace[fileType].latestDate = file.$updatedAt;
      }
    });

    return parseStringify(totalSpace);
  } catch (error) {
    handleError(error, "Error calculating total space used");
  }
}
