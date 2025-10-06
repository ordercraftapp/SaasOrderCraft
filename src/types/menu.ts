export type MenuItem = {
  id: string;
  name: string;
  price: number;
  categoryId?: string | null;
  categoryName?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  isAvailable: boolean;
  createdAt?: string; // ISO para el cliente
  updatedAt?: string; // ISO para el cliente
};

// Payload para crear/actualizar
export type MenuItemInput = {
  name: string;
  price: number;
  categoryId?: string | null;
  categoryName?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  isAvailable?: boolean;
};
