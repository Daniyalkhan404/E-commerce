import { defineQuery } from "next-sanity"
import { sanityFetch } from "../live";

export const getProductsByCategory = async (categorySlug: string) =>{
    const PRODUCT_BY_CATEGORY_QUERY = defineQuery(`
        *[
            _type == "product"
            && references(*[_type == "category" && slug.current == $categorySlug]._id)
        ] | order(name asc)
        `);
  try {
    const Products = await sanityFetch ({
        query:PRODUCT_BY_CATEGORY_QUERY,
        params: {
            categorySlug,
        },
    });

    return Products.data || [];
  } catch (error) {
    console.error("Error fetching products by category:", error);
    return[];
}     
};